"""Generates the Astrolabe roadmap page and registry data files from roadmap/*.yml.

Runs in three modes:
- Script (single page, default):
    python3 roadmap/build.py [--output docs/roadmap/index.md] [--root REPO_ROOT]
- Script (multi-page directory):
    python3 roadmap/build.py --out DIR [--root REPO_ROOT]
- MkDocs hook (`hooks:` in mkdocs.yml):
    adds roadmap/index.md, pillar pages, feature pages, roadmap/graph.json, and roadmap.json.

Uses PyYAML and Markdown when installed, with pure standard library fallbacks so the script
runs cleanly under bare `python3`.
"""

import argparse
import html
import json
import os
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

try:
    import yaml as _pyyaml
except ImportError:
    _pyyaml = None

try:
    from markdown.extensions.toc import slugify as _md_slugify
except ImportError:
    _md_slugify = None

REGISTRY = Path(__file__).resolve().parent
ROOT = REGISTRY.parent
DEFAULT_OUTPUT = Path("docs") / "roadmap" / "index.md"

STATUS_ORDER = ["shipped", "planned"]
STATUS_RANK = {
    "shipped": 0,
    "planned": 1,
}
SECTION_TITLES = {
    "shipped": "Shipped",
    "planned": "Planned",
}
BADGE_LABELS = {
    "shipped": "Shipped",
    "planned": "Planned",
}
STATUS_MEANINGS = {
    "shipped": "Astrolabe includes this feature in the current application.",
    "planned": "Astrolabe schedules this feature for a future release.",
}
PRIORITY_LABELS = {
    "core": "Core",
    "supporting": "Supporting",
}
FEATURE_KEYS = [
    "id",
    "title",
    "status",
    "priority",
    "summary",
    "depends_on",
    "docs",
]


class RegistryError(Exception):
    """The registry cannot be loaded; the message names the file and the id."""


# Minimal pure-stdlib YAML fallback

def _strip_comment(line):
    in_single = False
    in_double = False
    escaped = False
    for idx, ch in enumerate(line):
        if in_double:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_double = False
        elif in_single:
            if ch == "'":
                in_single = False
        else:
            if ch == '"':
                in_double = True
            elif ch == "'":
                in_single = True
            elif ch == "#" and (idx == 0 or line[idx - 1].isspace()):
                return line[:idx].rstrip()
    return line.rstrip()


def _split_flow(text):
    items = []
    cur = []
    in_single = False
    in_double = False
    escaped = False
    depth = 0
    for ch in text:
        if in_double:
            cur.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_double = False
        elif in_single:
            cur.append(ch)
            if ch == "'":
                in_single = False
        else:
            if ch == '"':
                in_double = True
                cur.append(ch)
            elif ch == "'":
                in_single = True
                cur.append(ch)
            elif ch in "[{":
                depth += 1
                cur.append(ch)
            elif ch in "]}":
                depth -= 1
                cur.append(ch)
            elif ch == "," and depth == 0:
                items.append("".join(cur).strip())
                cur = []
            else:
                cur.append(ch)
    tail = "".join(cur).strip()
    if tail:
        items.append(tail)
    return items


def _parse_scalar(raw):
    text = raw.strip()
    if not text or text in ("null", "~", "Null", "NULL"):
        return None
    if text in ("true", "True", "TRUE"):
        return True
    if text in ("false", "False", "FALSE"):
        return False
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1].strip()
        if not inner:
            return []
        return [_parse_scalar(part) for part in _split_flow(inner)]
    if text.startswith('"') and text.endswith('"') and len(text) >= 2:
        try:
            return json.loads(text)
        except json.JSONDecodeError as err:
            raise ValueError("invalid double-quoted string: %s" % err)
    if text.startswith("'") and text.endswith("'") and len(text) >= 2:
        return text[1:-1].replace("''", "'")
    if re.fullmatch(r"-?(?:0|[1-9][0-9]*)", text):
        return int(text)
    if re.fullmatch(r"-?(?:0|[1-9][0-9]*)\.[0-9]+", text):
        return float(text)
    return text


def _split_kv(text):
    in_single = False
    in_double = False
    escaped = False
    for idx, ch in enumerate(text):
        if in_double:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_double = False
        elif in_single:
            if ch == "'":
                in_single = False
        else:
            if ch == '"':
                in_double = True
            elif ch == "'":
                in_single = True
            elif ch == ":" and (idx + 1 == len(text) or text[idx + 1].isspace()):
                return text[:idx].strip(), text[idx + 1:].strip()
    return None, None


def _parse_yaml_stdlib(text):
    raw_lines = []
    for lineno, original in enumerate(text.splitlines(), 1):
        cleaned = _strip_comment(original)
        if not cleaned.strip():
            continue
        indent = len(cleaned) - len(cleaned.lstrip(" "))
        if "\t" in cleaned[:indent]:
            raise ValueError("line %d: tabs are not allowed in indentation" % lineno)
        raw_lines.append((lineno, indent, cleaned[indent:]))

    if not raw_lines:
        return None

    def parse_block(index, min_indent):
        lineno, indent, content = raw_lines[index]
        if indent < min_indent:
            return None, index
        if content == "-" or content.startswith("- "):
            return parse_list(index, indent)
        return parse_map(index, indent)

    def parse_list(index, list_indent):
        result = []
        while index < len(raw_lines):
            lineno, indent, content = raw_lines[index]
            if indent < list_indent:
                break
            if indent != list_indent or not (content == "-" or content.startswith("- ")):
                break
            rest = content[1:].strip()
            index += 1
            if not rest:
                if index < len(raw_lines) and raw_lines[index][1] > list_indent:
                    item, index = parse_block(index, raw_lines[index][1])
                else:
                    item = None
                result.append(item)
                continue
            key, val = _split_kv(rest)
            if key is not None:
                entry = {}
                item_indent = list_indent + 2
                if val in (">", "|"):
                    folded, index = parse_multiline(index, item_indent, val == ">")
                    entry[key] = folded
                elif val == "":
                    if index < len(raw_lines) and raw_lines[index][1] > item_indent:
                        entry[key], index = parse_block(index, raw_lines[index][1])
                    else:
                        entry[key] = None
                else:
                    entry[key] = _parse_scalar(val)
                while index < len(raw_lines) and raw_lines[index][1] >= item_indent:
                    cur_lineno, cur_indent, cur_content = raw_lines[index]
                    if cur_indent > item_indent:
                        raise ValueError("line %d: unexpected indentation" % cur_lineno)
                    k, v = _split_kv(cur_content)
                    if k is None:
                        raise ValueError("line %d: expected key: value" % cur_lineno)
                    index += 1
                    if v in (">", "|"):
                        entry[k], index = parse_multiline(index, cur_indent + 1, v == ">")
                    elif v == "":
                        if index < len(raw_lines) and raw_lines[index][1] > cur_indent:
                            entry[k], index = parse_block(index, raw_lines[index][1])
                        else:
                            entry[k] = None
                    else:
                        entry[k] = _parse_scalar(v)
                result.append(entry)
            else:
                result.append(_parse_scalar(rest))
        return result, index

    def parse_multiline(index, min_indent, fold):
        parts = []
        while index < len(raw_lines) and raw_lines[index][1] >= min_indent:
            parts.append(raw_lines[index][2])
            index += 1
        return (" " if fold else "\n").join(parts), index

    def parse_map(index, map_indent):
        result = {}
        while index < len(raw_lines):
            lineno, indent, content = raw_lines[index]
            if indent < map_indent:
                break
            if indent > map_indent:
                raise ValueError("line %d: unexpected indentation" % lineno)
            key, val = _split_kv(content)
            if key is None:
                raise ValueError("line %d: expected key: value" % lineno)
            index += 1
            if val in (">", "|"):
                result[key], index = parse_multiline(index, map_indent + 1, val == ">")
            elif val == "":
                if index < len(raw_lines) and raw_lines[index][1] > map_indent:
                    result[key], index = parse_block(index, raw_lines[index][1])
                else:
                    result[key] = None
            else:
                result[key] = _parse_scalar(val)
        return result, index

    data, next_index = parse_block(0, raw_lines[0][1])
    if next_index != len(raw_lines):
        raise ValueError("line %d: trailing content" % raw_lines[next_index][0])
    return data


def load_yaml(text):
    """Parses YAML with PyYAML when installed, or the built-in subset parser."""
    if _pyyaml is not None:
        try:
            return _pyyaml.safe_load(text)
        except _pyyaml.YAMLError as err:
            raise ValueError(str(err))
    return _parse_yaml_stdlib(text)


def slugify(value, separator="-"):
    if _md_slugify is not None:
        return _md_slugify(value, separator)
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^\w\s-]", "", normalized).strip().lower()
    return re.sub(r"[-\s]+", separator, cleaned)


def _site_url(root=ROOT):
    try:
        data = load_yaml((Path(root) / "mkdocs.yml").read_text(encoding="utf-8"))
        return (data or {}).get("site_url") or "/"
    except (OSError, ValueError):
        return "/"


DEFAULT_SITE = _site_url()


def id_key(fid):
    """Sorts ids by prefix and then by number so OBS-09 precedes OBS-10."""
    prefix, _, number = fid.partition("-")
    return (prefix, int(number) if number.isdigit() else 0, fid)


_MD_SPECIAL = re.compile(r"([\\`*_\[\]|#])")


def md(text):
    """Escapes registry text for Markdown prose and table cells."""
    return _MD_SPECIAL.sub(r"\\\1", html.escape(str(text).strip(), quote=False))


# Markdown heading parsing

_FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
_ATX = re.compile(r"^\s{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$")


def heading_text(raw):
    text = re.sub(r"(?<!`)<[A-Za-z/][^<>`]*>(?!`)", "", raw)
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"!?\[([^\]]*)\]\[[^\]]*\]", r"\1", text)
    text = text.replace("`", "")
    text = re.sub(r"(\*\*|__)(.+?)\1", r"\2", text)
    text = re.sub(r"\*(.+?)\*", r"\1", text)
    return text.strip()


def parse_headings(markdown_text):
    found = []
    seen = set()
    fence = None
    for line in markdown_text.splitlines():
        m = _FENCE.match(line)
        if m:
            marker = m.group(1)
            if fence is None:
                fence = marker[0]
            elif marker[0] == fence:
                fence = None
            continue
        if fence is not None:
            continue
        m = _ATX.match(line)
        if not m:
            continue
        text = heading_text(m.group(2))
        slug = base = slugify(text, "-")
        n = 0
        while slug in seen:
            n += 1
            slug = "%s_%d" % (base, n)
        seen.add(slug)
        found.append((len(m.group(1)), text, slug))
    return found


def read_headings(path):
    try:
        return parse_headings(Path(path).read_text(encoding="utf-8"))
    except OSError:
        return None


def split_ref(ref):
    path, _, anchor = ref.partition("#")
    return path, (anchor or None)


# Registry loading

def read_files(root):
    """Returns [(relative_name, data)] for every pillar file under root/roadmap."""
    folder = Path(root) / "roadmap"
    result = []
    for path in sorted(folder.glob("*.yml")):
        try:
            data = load_yaml(path.read_text(encoding="utf-8"))
        except ValueError as err:
            raise RegistryError("roadmap/%s: not valid YAML: %s" % (path.name, err))
        result.append(("roadmap/" + path.name, data))
    return result


def load_registry(root):
    """Returns (pillars, features) from roadmap/*.yml under root."""
    pillars = []
    features = {}
    for name, data in read_files(root):
        if not isinstance(data, dict):
            raise RegistryError("%s: not a pillar mapping" % name)
        pillar = {
            "prefix": data["prefix"],
            "title": data["title"],
            "slug": Path(name).stem,
            "order": data["order"],
            "summary": data["summary"],
            "file": name,
            "features": [],
        }
        for raw in data.get("features") or []:
            fid = raw["id"]
            if fid in features:
                raise RegistryError("%s: %s: duplicate id" % (name, fid))
            feature = {key: raw.get(key) for key in FEATURE_KEYS}
            feature["depends_on"] = sorted(raw.get("depends_on") or [], key=id_key)
            feature["pillar"] = pillar["prefix"]
            feature["pillar_title"] = pillar["title"]
            feature["pillar_slug"] = pillar["slug"]
            feature["file"] = name
            feature["unblocks"] = []
            features[fid] = feature
            pillar["features"].append(feature)
        pillar["features"].sort(key=lambda f: id_key(f["id"]))
        pillars.append(pillar)
    pillars.sort(key=lambda p: (p["order"], p["prefix"]))
    for fid in sorted(features, key=id_key):
        for dep in features[fid]["depends_on"]:
            if dep not in features:
                raise RegistryError(
                    "%s: %s: depends_on %s, which does not exist"
                    % (features[fid]["file"], fid, dep)
                )
            features[dep]["unblocks"].append(fid)
    for feature in features.values():
        feature["unblocks"].sort(key=id_key)
    return pillars, features


# Rendering helpers

def _node_id(fid):
    return fid.replace("-", "_")


def _mermaid_label(fid, title):
    clean = str(title).replace('"', "'")
    return "%s %s" % (fid, clean)


def _node_class(feature):
    return feature["status"]


def _pillar_mermaid(pillar, features):
    in_pillar = {f["id"] for f in pillar["features"]}
    external_deps = sorted(
        {
            dep
            for f in pillar["features"]
            for dep in f["depends_on"]
            if dep not in in_pillar
        },
        key=id_key,
    )
    lines = ["```mermaid", "flowchart LR"]
    for f in pillar["features"]:
        label = _mermaid_label(f["id"], f["title"])
        lines.append('  %s["%s"]:::%s' % (_node_id(f["id"]), label, _node_class(f)))
    for dep in external_deps:
        target = features[dep]
        label = _mermaid_label(target["id"], target["title"])
        lines.append('  %s["%s"]:::external' % (_node_id(dep), label))
    for f in pillar["features"]:
        for dep in f["depends_on"]:
            arrow = "-.->" if dep not in in_pillar else "-->"
            lines.append("  %s %s %s" % (_node_id(dep), arrow, _node_id(f["id"])))
    lines += [
        "  classDef shipped fill:#1b4332,stroke:#52b788,color:#f8f9fa",
        "  classDef planned fill:#2b2d42,stroke:#9ca3af,color:#f8f9fa",
        "  classDef external fill:#1f242d,stroke:#868e96,color:#dee2e6,stroke-dasharray:5 3",
        "```",
    ]
    return lines


def _format_deps(ids):
    if not ids:
        return "None"
    return ", ".join("`%s`" % fid for fid in ids)


def _format_docs(base_dir, ref):
    if not ref:
        return "None"
    path, _ = split_ref(ref)
    if path.startswith("docs/"):
        target = os.path.relpath(path[len("docs/"):], base_dir).replace(os.sep, "/")
        return "[`%s`](%s)" % (Path(path).name, target)
    return "`%s`" % ref


def render_page(root):
    """Generates the single-page Markdown roadmap registry with per-pillar Mermaid graphs."""
    pillars, features = load_registry(root)
    all_features = [features[fid] for fid in sorted(features, key=id_key)]
    status_counts = Counter(f["status"] for f in all_features)
    edge_count = sum(len(f["depends_on"]) for f in all_features)

    lines = [
        "<!-- Generated by roadmap/build.py from roadmap/*.yml. Do not edit by hand. -->",
        "",
        "# Roadmap",
        "",
        "This page lists every product feature of Astrolabe across five pillars.",
        "Each feature has a status of Shipped or Planned and lists its direct dependencies.",
        "The dependency graphs show how planned features build on shipped foundations across pillars.",
        "",
        "## Registry Overview",
        "",
        "The registry tracks %d features and %d dependency edges across %d pillars."
        % (len(all_features), edge_count, len(pillars)),
        "",
        "### Status Counts",
        "",
        "| Status | Count | Meaning |",
        "| --- | ---: | --- |",
    ]
    for status in STATUS_ORDER:
        lines.append(
            "| %s | %d | %s |"
            % (BADGE_LABELS[status], status_counts[status], STATUS_MEANINGS[status])
        )
    lines += [
        "",
        "### Pillar Breakdown",
        "",
        "| Pillar | Prefix | Total | Shipped | Planned |",
        "| --- | --- | ---: | ---: | ---: |",
    ]
    for p in pillars:
        pf = p["features"]
        pcounts = Counter(f["status"] for f in pf)
        anchor = slugify(p["title"], "-")
        lines.append(
            "| [%s](#%s) | `%s` | %d | %d | %d |"
            % (
                md(p["title"]),
                anchor,
                p["prefix"],
                len(pf),
                pcounts["shipped"],
                pcounts["planned"],
            )
        )
    lines.append("")

    for p in pillars:
        lines += [
            "## %s" % md(p["title"]),
            "",
            md(p["summary"]),
            "",
        ]
        lines += _pillar_mermaid(p, features)
        lines += [
            "",
            "| ID | Feature | Status | Priority | Depends On | Docs | Summary |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for f in p["features"]:
            lines.append(
                "| `%s` | %s | %s | %s | %s | %s | %s |"
                % (
                    f["id"],
                    md(f["title"]),
                    BADGE_LABELS[f["status"]],
                    PRIORITY_LABELS[f["priority"]],
                    _format_deps(f["depends_on"]),
                    _format_docs("roadmap", f.get("docs")),
                    md(f["summary"]),
                )
            )
        lines.append("")

    return "\n".join(lines)


# Multi-page and JSON generators

def _feature_links(ids, features):
    if not ids:
        return "None"
    return "<br>".join(
        "[%s](%s.md) (`%s`)" % (md(features[i]["title"]), i.lower(), i) for i in ids
    )


def pillar_page(pillar, features):
    lines = [
        "# " + md(pillar["title"]),
        "",
        md(pillar["summary"]),
        "",
        "Return to [Roadmap](index.md) for cross-pillar counts and the full feature list.",
        "",
    ]
    lines += _pillar_mermaid(pillar, features)
    lines.append("")
    for status in STATUS_ORDER:
        items = [f for f in pillar["features"] if f["status"] == status]
        if not items:
            continue
        lines += ["## " + SECTION_TITLES[status], ""]
        for f in items:
            lines.append(
                "- `%s` [%s](%s.md). %s"
                % (f["id"], md(f["title"]), f["id"].lower(), md(f["summary"]))
            )
        lines.append("")
    return "\n".join(lines)


def feature_page(feature, pillars_by_prefix, features):
    pillar = pillars_by_prefix[feature["pillar"]]
    rows = [
        ("ID", "`%s`" % feature["id"]),
        ("Status", BADGE_LABELS[feature["status"]]),
        ("Priority", PRIORITY_LABELS[feature["priority"]]),
        ("Pillar", "[%s](%s.md)" % (md(pillar["title"]), pillar["slug"])),
        ("Depends On", _feature_links(feature["depends_on"], features)),
        ("Unblocks", _feature_links(feature["unblocks"], features)),
        ("Docs", _format_docs("roadmap", feature.get("docs"))),
    ]
    lines = ["# " + md(feature["title"]), "", md(feature["summary"]), ""]
    lines += ["| Field | Value |", "| --- | --- |"]
    lines += ["| %s | %s |" % row for row in rows]
    lines.append("")
    return "\n".join(lines)


def _dump(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def graph_json(pillars, features):
    order = {p["prefix"]: p["order"] for p in pillars}
    nodes = []
    for f in sorted(features.values(), key=lambda f: (order[f["pillar"]], id_key(f["id"]))):
        nodes.append(
            {
                "id": f["id"],
                "title": f["title"],
                "status": f["status"],
                "priority": f["priority"],
                "pillar": f["pillar"],
                "summary": f["summary"],
                "docs": f["docs"],
                "url": f["id"].lower() + "/",
            }
        )
    edges = []
    for f in sorted(features.values(), key=lambda f: id_key(f["id"])):
        for dep in f["depends_on"]:
            edges.append(
                {
                    "id": "%s>%s" % (dep, f["id"]),
                    "from": dep,
                    "to": f["id"],
                }
            )
    edges.sort(key=lambda e: (id_key(e["to"]), id_key(e["from"])))
    return _dump(
        {
            "pillars": [
                {
                    "prefix": p["prefix"],
                    "title": p["title"],
                    "slug": p["slug"],
                    "order": p["order"],
                    "url": p["slug"] + "/",
                }
                for p in pillars
            ],
            "nodes": nodes,
            "edges": edges,
        }
    )


def registry_json(pillars, features, site):
    return _dump(
        {
            "site": site,
            "pillars": [
                {
                    "prefix": p["prefix"],
                    "title": p["title"],
                    "slug": p["slug"],
                    "order": p["order"],
                    "summary": p["summary"],
                    "url": "%sroadmap/%s/" % (site, p["slug"]),
                    "features": [f["id"] for f in p["features"]],
                }
                for p in pillars
            ],
            "features": [
                {
                    "id": f["id"],
                    "title": f["title"],
                    "status": f["status"],
                    "priority": f["priority"],
                    "pillar": f["pillar"],
                    "summary": f["summary"],
                    "depends_on": f["depends_on"],
                    "unblocks": f["unblocks"],
                    "docs": f["docs"],
                    "url": "%sroadmap/%s/" % (site, f["id"].lower()),
                }
                for f in sorted(features.values(), key=lambda f: id_key(f["id"]))
            ],
        }
    )


def generate(root, site=DEFAULT_SITE):
    """Returns [(src_uri, content, in_nav)] for multi-page and MkDocs hook output."""
    if not site.endswith("/"):
        site += "/"
    pillars, features = load_registry(root)
    by_prefix = {p["prefix"]: p for p in pillars}
    out = [("roadmap/index.md", render_page(root), True)]
    for p in pillars:
        out.append(("roadmap/%s.md" % p["slug"], pillar_page(p, features), True))
    for fid in sorted(features, key=id_key):
        out.append(
            (
                "roadmap/%s.md" % fid.lower(),
                feature_page(features[fid], by_prefix, features),
                False,
            )
        )
    out.append(("roadmap/graph.json", graph_json(pillars, features), True))
    out.append(("roadmap.json", registry_json(pillars, features, site), True))
    return out


# MkDocs hook

def on_files(files, config):
    from mkdocs.structure.files import File, InclusionLevel

    site = config.get("site_url") or DEFAULT_SITE
    for src_uri, content, in_nav in generate(ROOT, site):
        kwargs = {} if in_nav else {"inclusion": InclusionLevel.NOT_IN_NAV}
        files.append(File.generated(config, src_uri, content=content, **kwargs))
    return files


def resolve_output(root, output_arg):
    if output_arg:
        path = Path(output_arg)
        return path if path.is_absolute() else Path(root) / path
    return Path(root) / DEFAULT_OUTPUT


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Generate the Astrolabe roadmap page or multi-page files from roadmap/*.yml."
    )
    parser.add_argument(
        "--output",
        default=None,
        help="output Markdown file path (defaults to docs/roadmap/index.md)",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="optional directory for multi-page Markdown and JSON output",
    )
    parser.add_argument("--site-url", default=DEFAULT_SITE)
    parser.add_argument("--root", default=str(ROOT), help="repository root")
    args = parser.parse_args(argv)
    root = Path(args.root)
    try:
        if args.out:
            generated = generate(root, args.site_url)
            for src_uri, content, _ in generated:
                target = Path(args.out) / src_uri
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
            print("wrote %d files under %s" % (len(generated), args.out))
            return 0
        page = render_page(root)
    except RegistryError as err:
        print(err, file=sys.stderr)
        return 1
    target = resolve_output(root, args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(page, encoding="utf-8")
    print("wrote %s" % target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
