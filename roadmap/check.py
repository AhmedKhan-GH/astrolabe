"""Checks the Astrolabe roadmap registry: `python3 roadmap/check.py [--root REPO_ROOT]`.

Prints one line per problem as `<file>: <id>: <message>`. Exits 1 when any error is found
and 0 otherwise. Warnings print with the word warning and do not change the exit code.

Uses jsonschema and PyYAML when installed, with pure standard library fallbacks so the
checker runs cleanly under bare `python3`.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

try:
    import jsonschema as _jsonschema
except ImportError:
    _jsonschema = None

sys.dont_write_bytecode = True
import build

STATUSES = build.STATUS_ORDER
SCOPES = ("core", "supporting", "peripheral")

MINOR_WORDS = frozenset(
    "a an the and but or nor for so yet as at by in of on per to up via vs "
    "with from into onto over than".split()
)
IDENTIFIER_WORDS = frozenset(
    "macos ios npm pip uv git cargo rustc rustup egui sqlite astrolabe rustfmt clippy "
    "zcode arm64 x86".split()
)
ARTICLE_WORDS = {"the", "a", "an"}
IDENTIFIER_CHARS = re.compile(r"[._/\\=()<>]")
NUMBERING = re.compile(r"^\d+(\.\d+)*[.)]?$")
CODE_SPAN = re.compile(r"(`+)(.+?)\1")
PLACEHOLDER = re.compile(r"\x00(\d+)\x00")

_USER_HOME_PREFIX = "/".join(["", "Users", ""])
_LINUX_HOME_PREFIX = "/".join(["", "home", ""])
_WIN_HOME_PREFIX = "\\".join(["C:", "Users", ""])

PRIVACY_PATTERNS = [
    (
        "home directory path",
        re.compile(
            r"(?:%s|%s|%s)[A-Za-z0-9._-]+"
            % (
                re.escape(_USER_HOME_PREFIX),
                re.escape(_LINUX_HOME_PREFIX),
                re.escape(_WIN_HOME_PREFIX),
            )
        ),
    ),
    (
        "email address",
        re.compile(r"[A-Za-z0-9._%+-]+" + chr(64) + r"[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    ),
    ("personal GitHub profile URL", re.compile(r"https?://github\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+")),
]


# Title rule checks

def _strip_inline(text):
    spans = []

    def keep(match):
        spans.append(match.group(2))
        return "\x00%d\x00" % (len(spans) - 1)

    text = CODE_SPAN.sub(keep, text)
    text = re.sub(r"[ \t]*\{[^{}]*\}[ \t]*$", "", text)
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]*)\]\[[^\]]*\]", r"\1", text)
    text = re.sub(r"\*+", "", text)
    return text.strip(), spans


def _clean_token(token):
    token = token.lstrip("([\"'\u201c\u2018")
    token = token.rstrip(",;.)]\"'\u201d\u2019?!")
    return token


def _words_of(text):
    words = []
    for token in text.split():
        word = _clean_token(token)
        if not word or not any(c.isalnum() or c == "\x00" for c in word):
            continue
        words.append(word)
    if len(words) > 1 and NUMBERING.match(words[0]):
        words = words[1:]
    return words


def _part_fails(part, first):
    if not part or "\x00" in part:
        return False
    if not part[0].isalpha():
        return False
    if part[0].isupper():
        return False
    if any(c.isupper() for c in part[1:]):
        return False
    if IDENTIFIER_CHARS.search(part):
        return False
    if part.lower() in IDENTIFIER_WORDS:
        return False
    if re.fullmatch(r"v\d+([._]\d+)*", part):
        return False
    if part in MINOR_WORDS and not first:
        return False
    return True


def _word_failure(word, first_word):
    if word.startswith("-") or "\x00" in word:
        return None
    if IDENTIFIER_CHARS.search(word):
        return None
    for index, part in enumerate(word.split("-")):
        if _part_fails(part, first_word and index == 0):
            return word
    return None


def judge_title(heading):
    """Returns a failure reason string when a title breaks the Title Case rule, else None."""
    text, _ = _strip_inline(str(heading))
    words = _words_of(text)
    if not words:
        return "empty title"
    first = words[0].lower()
    if first in ARTICLE_WORDS:
        return "starts with an article"
    if first == "your":
        return "starts with Your"
    if ":" in PLACEHOLDER.sub("", text):
        return "contains a colon"
    if text.rstrip().endswith("?"):
        return "ends with a question mark"
    for index, word in enumerate(words):
        bad = _word_failure(word, index == 0)
        if bad:
            return "not Title Case (%s)" % bad
    return None


# Pure-stdlib JSON Schema Draft 2020-12 subset validator fallback

def _type_matches(value, expected):
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    return True


def _resolve_ref(root_schema, ref):
    if not ref.startswith("#/"):
        raise ValueError("unsupported $ref: %s" % ref)
    node = root_schema
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def _validate_stdlib(instance, schema, root_schema, path=()):
    errors = []
    if "$ref" in schema:
        schema = _resolve_ref(root_schema, schema["$ref"])
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_type_matches(instance, t) for t in types):
            errors.append((path, "%r is not of type %s" % (instance, ", ".join(types))))
            return errors
    if "const" in schema and instance != schema["const"]:
        errors.append((path, "%r was expected to equal %r" % (instance, schema["const"])))
    if "enum" in schema and instance not in schema["enum"]:
        errors.append((path, "%r is not one of %r" % (instance, schema["enum"])))
    if isinstance(instance, str):
        if "minLength" in schema and len(instance) < schema["minLength"]:
            errors.append((path, "string shorter than minLength %d" % schema["minLength"]))
        if "maxLength" in schema and len(instance) > schema["maxLength"]:
            errors.append((path, "string longer than maxLength %d" % schema["maxLength"]))
        if "pattern" in schema and re.search(schema["pattern"], instance) is None:
            errors.append((path, "%r does not match %r" % (instance, schema["pattern"])))
    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        if "minimum" in schema and instance < schema["minimum"]:
            errors.append((path, "%r is less than minimum %r" % (instance, schema["minimum"])))
    if isinstance(instance, list):
        if "minItems" in schema and len(instance) < schema["minItems"]:
            errors.append((path, "array has fewer than %d items" % schema["minItems"]))
        if schema.get("uniqueItems"):
            seen = []
            for item in instance:
                if item in seen:
                    errors.append((path, "duplicate array item %r" % (item,)))
                    break
                seen.append(item)
        if "items" in schema:
            for idx, item in enumerate(instance):
                errors.extend(_validate_stdlib(item, schema["items"], root_schema, path + (idx,)))
    if isinstance(instance, dict):
        for req in schema.get("required") or []:
            if req not in instance:
                errors.append((path, "%r is a required property" % req))
        props = schema.get("properties") or {}
        if schema.get("additionalProperties") is False:
            for key in sorted(instance):
                if key not in props:
                    errors.append((path + (key,), "additional property %r is not allowed" % key))
        for key, subschema in props.items():
            if key in instance:
                errors.extend(_validate_stdlib(instance[key], subschema, root_schema, path + (key,)))
    if "anyOf" in schema:
        if not any(not _validate_stdlib(instance, sub, root_schema, path) for sub in schema["anyOf"]):
            errors.append((path, "%r does not match any allowed schema" % (instance,)))
    if "allOf" in schema:
        for sub in schema["allOf"]:
            errors.extend(_validate_stdlib(instance, sub, root_schema, path))
    if "if" in schema:
        cond_ok = not _validate_stdlib(instance, schema["if"], root_schema, path)
        if cond_ok and "then" in schema:
            errors.extend(_validate_stdlib(instance, schema["then"], root_schema, path))
        elif not cond_ok and "else" in schema:
            errors.extend(_validate_stdlib(instance, schema["else"], root_schema, path))
    return errors


def validate_schema(data, schema):
    if _jsonschema is not None:
        validator = _jsonschema.Draft202012Validator(schema)
        problems = sorted(validator.iter_errors(data), key=lambda e: list(map(str, e.path)))
        return [(tuple(err.absolute_path), err.message) for err in problems]
    return sorted(_validate_stdlib(data, schema, schema), key=lambda item: list(map(str, item[0])))


# Helpers

def _has_todo(value):
    if isinstance(value, str):
        return "TODO" in value
    if isinstance(value, dict):
        return any(_has_todo(v) for v in value.values())
    if isinstance(value, list):
        return any(_has_todo(v) for v in value)
    return False


def _todo_fields(feature):
    return [k for k, v in feature.items() if _has_todo(v)]


def _privacy_hits(text):
    hits = []
    for label, pattern in PRIVACY_PATTERNS:
        if pattern.search(text):
            hits.append(label)
    current_user = os.environ.get("USER") or ""
    if len(current_user) >= 4:
        if re.search(r"\b%s\b" % re.escape(current_user), text, re.I):
            hits.append("local username")
    return hits


def _scan_privacy(value, name, fid, errors):
    if isinstance(value, str):
        for label in _privacy_hits(value):
            errors.append("%s: %s: privacy check failed (%s)" % (name, fid, label))
    elif isinstance(value, dict):
        for v in value.values():
            _scan_privacy(v, name, fid, errors)
    elif isinstance(value, list):
        for item in value:
            _scan_privacy(item, name, fid, errors)


def _find_cycle(graph):
    """Returns one cycle as a list of ids, first id repeated at the end, or None."""
    state = {}
    stack = []

    def visit(node):
        state[node] = 1
        stack.append(node)
        for nxt in sorted(graph.get(node, []), key=build.id_key):
            if nxt not in graph:
                continue
            if state.get(nxt) == 1:
                return stack[stack.index(nxt):] + [nxt]
            if nxt not in state:
                found = visit(nxt)
                if found:
                    return found
        stack.pop()
        state[node] = 2
        return None

    for node in sorted(graph, key=build.id_key):
        if node not in state:
            found = visit(node)
            if found:
                return found
    return None


def _check_ref(root, name, fid, field, ref, errors):
    path, anchor = build.split_ref(ref)
    headings = build.read_headings(root / path)
    if headings is None:
        errors.append("%s: %s: %s page %s does not exist" % (name, fid, field, path))
        return
    if anchor and anchor not in [slug for _, _, slug in headings]:
        errors.append(
            "%s: %s: %s anchor #%s is not a heading on %s"
            % (name, fid, field, anchor, path)
        )


def run_checks(root):
    """Returns (errors, warnings, summary) for the registry under root."""
    root = Path(root)
    errors, warnings = [], []
    try:
        files = build.read_files(root)
    except build.RegistryError as err:
        return [str(err)], [], ""

    if not files:
        return ["roadmap: -: no pillar .yml files found"], [], ""

    for extra in sorted((root / "roadmap").glob("*.yaml")):
        errors.append(
            "roadmap/%s: -: pillar files end in .yml, so this file is not read" % extra.name
        )

    schema_path = root / "roadmap" / "schema.json"
    if not schema_path.is_file():
        return ["roadmap/schema.json: -: schema file is missing"], [], ""
    schema = json.loads(schema_path.read_text(encoding="utf-8"))

    valid = []
    for name, data in files:
        problems = validate_schema(data, schema)
        for path, msg in problems:
            where = "/".join(str(p) for p in path) or "-"
            fid = "-"
            if len(path) >= 2 and path[0] == "features" and isinstance(data, dict):
                try:
                    fid = data["features"][path[1]].get("id", "-")
                except (KeyError, IndexError, AttributeError, TypeError):
                    pass
            errors.append("%s: %s: schema: %s: %s" % (name, fid, where, msg))
        if not problems:
            valid.append((name, data))
    if errors:
        return errors, [], ""

    prefixes, orders = {}, {}
    for name, data in valid:
        if data["prefix"] in prefixes:
            errors.append(
                "%s: -: duplicate prefix %s, also used by %s"
                % (name, data["prefix"], prefixes[data["prefix"]])
            )
        prefixes.setdefault(data["prefix"], name)
        if data["order"] in orders:
            errors.append(
                "%s: -: duplicate order %d, also used by %s"
                % (name, data["order"], orders[data["order"]])
            )
        orders.setdefault(data["order"], name)
        header_data = {k: v for k, v in data.items() if k != "features"}
        if _has_todo(header_data):
            errors.append("%s: -: contains TODO" % name)
        _scan_privacy(header_data, name, "-", errors)
        reason = judge_title(data["title"])
        if reason:
            errors.append('%s: -: pillar title "%s" %s' % (name, data["title"], reason))

    # The roadmap section navigation is written by hand and must list every pillar page.
    nav_rel = "docs/roadmap/.nav.yml"
    nav_path = root / nav_rel
    if nav_path.is_file():
        nav_text = nav_path.read_text(encoding="utf-8")
        for name, _ in valid:
            page = Path(name).stem + ".md"
            if not re.search(r"^\s*-\s*%s\s*$" % re.escape(page), nav_text, re.M):
                errors.append(
                    "%s: -: %s does not list the pillar page %s" % (name, nav_rel, page)
                )

    features = {}
    feature_pillar = {}
    for name, data in valid:
        for f in data["features"]:
            fid = f["id"]
            if fid in features:
                errors.append("%s: %s: duplicate id, also in %s" % (name, fid, features[fid][0]))
                continue
            features[fid] = (name, f)
            feature_pillar[fid] = data["prefix"]
            if not fid.startswith(data["prefix"] + "-"):
                errors.append(
                    "%s: %s: id does not use pillar prefix %s" % (name, fid, data["prefix"])
                )
            if f.get("scope") not in SCOPES:
                errors.append(
                    "%s: %s: scope %r is not one of %s"
                    % (name, fid, f.get("scope"), ", ".join(SCOPES))
                )
            for field in _todo_fields(f):
                errors.append("%s: %s: %s contains TODO" % (name, fid, field))
            _scan_privacy(f, name, fid, errors)
            reason = judge_title(f["title"])
            if reason:
                errors.append('%s: %s: title "%s" %s' % (name, fid, f["title"], reason))

    graph = {}
    cross_pillar_edges = 0
    for fid, (name, f) in sorted(features.items(), key=lambda item: build.id_key(item[0])):
        deps = f.get("depends_on") or []
        graph[fid] = deps
        for dep in deps:
            if dep == fid:
                errors.append("%s: %s: depends on itself" % (name, fid))
            elif dep not in features:
                errors.append("%s: %s: depends_on %s, which does not exist" % (name, fid, dep))
            elif feature_pillar[dep] != feature_pillar[fid]:
                cross_pillar_edges += 1

    cycle = _find_cycle({k: [d for d in v if d != k] for k, v in graph.items()})
    if cycle:
        errors.append(
            "%s: %s: dependency cycle %s"
            % (features[cycle[0]][0], cycle[0], " -> ".join(cycle))
        )

    rank = build.STATUS_RANK
    for fid, (name, f) in sorted(features.items(), key=lambda item: build.id_key(item[0])):
        if f["status"] == "shipped" and not f.get("docs"):
            errors.append("%s: %s: shipped feature has no docs" % (name, fid))
        if f.get("docs"):
            _check_ref(root, name, fid, "docs", f["docs"], errors)
        for dep in f.get("depends_on") or []:
            if dep in features and dep != fid:
                dep_feature = features[dep][1]
                dstatus = dep_feature["status"]
                if rank[dstatus] > rank[f["status"]]:
                    errors.append(
                        "%s: %s: %s depends on %s, which is %s and has a higher status rank"
                        % (name, fid, f["status"], dep, dstatus)
                    )
                if f.get("scope") == "core" and dep_feature.get("scope") != "core":
                    errors.append(
                        "%s: %s: core feature depends on %s, which has scope %s"
                        % (name, fid, dep, dep_feature.get("scope"))
                    )

    if not errors:
        try:
            build.load_registry(root)
        except build.RegistryError as err:
            errors.append(str(err))

    # Redundant edges: a dependency already reachable through another dependency.
    def reach(start, seen):
        for nxt in graph.get(start, []):
            if nxt in graph and nxt not in seen:
                seen.add(nxt)
                reach(nxt, seen)
        return seen

    if not cycle:
        for fid, (name, f) in sorted(features.items(), key=lambda item: build.id_key(item[0])):
            deps = [d for d in graph[fid] if d in features and d != fid]
            for dep in sorted(deps, key=build.id_key):
                for other in sorted(deps, key=build.id_key):
                    if other != dep and dep in reach(other, set()):
                        warnings.append(
                            "%s: %s: warning: depends_on %s is already implied through %s"
                            % (name, fid, dep, other)
                        )
                        break

    # Privacy scan across roadmap code and schema files
    for code_name in ("schema.json", "build.py", "check.py"):
        code_path = root / "roadmap" / code_name
        if code_path.is_file():
            text = code_path.read_text(encoding="utf-8")
            for label in _privacy_hits(text):
                errors.append("roadmap/%s: -: privacy check failed (%s)" % (code_name, label))

    status_counts = Counter(f["status"] for _, f in features.values())
    scope_counts = Counter(f["scope"] for _, f in features.values())
    edges = sum(len(v) for v in graph.values())
    summary = "%d features, %d edges (%s; %s; %d cross-pillar)" % (
        len(features),
        edges,
        ", ".join("%d %s" % (status_counts[s], s) for s in STATUSES),
        ", ".join("%d %s" % (scope_counts[s], s) for s in SCOPES),
        cross_pillar_edges,
    )
    return errors, warnings, summary


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check the Astrolabe roadmap registry.")
    parser.add_argument("--root", default=str(build.ROOT), help="repository root")
    args = parser.parse_args(argv)
    errors, warnings, summary = run_checks(args.root)
    for line in errors + warnings:
        print(line)
    if errors:
        return 1
    print("ok: " + summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
