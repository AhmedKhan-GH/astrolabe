//! The query language of the filter box and smart folders: parsing text such as
//! `northstar AND NOT third-party` into a tree, and evaluating it against one
//! repository. Pure; no I/O.

use super::model::tag_slug;

/// A parsed query.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Query {
    /// The empty query; it matches every repository.
    All,
    Term(Term),
    Not(Box<Query>),
    /// Two or more; never nested directly inside another And.
    And(Vec<Query>),
    /// Two or more; never nested directly inside another Or.
    Or(Vec<Query>),
}

/// One condition on a repository.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Term {
    /// A bare or quoted word, lowercase: a tag when the vocabulary knows it, otherwise text in the name or location.
    Word(String),
    /// `tag:x`: has the tag x (stored as `tag_slug(x)`).
    Tag(String),
    /// `name:x`: the name contains x (lowercase).
    Name(String),
    /// `path:x`: the location contains x (lowercase).
    Path(String),
}

/// Why a query could not be parsed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseError {
    /// A short plain sentence, such as "Missing a closing parenthesis."
    pub message: String,
    /// Byte offset in the text where the problem is.
    pub at: usize,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

fn error<T>(message: &str, at: usize) -> Result<T, ParseError> {
    Err(ParseError { message: message.to_string(), at })
}

// ---------------------------------------------------------------------------
// Lexing

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Field {
    Tag,
    Name,
    Path,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Tok {
    Open,
    Close,
    And,
    Or,
    /// `NOT`, or a `-` in front of what it negates.
    Not {
        dash: bool,
    },
    Word(String),
    Field(Field, String),
}

const FIELDS: [(&str, Field); 3] = [("tag:", Field::Tag), ("name:", Field::Name), ("path:", Field::Path)];

/// Reads a quoted text whose opening quote is at `start`; returns the text and the offset after the closing quote.
fn read_quoted(text: &str, start: usize) -> Result<(String, usize), ParseError> {
    match text[start + 1..].find('"') {
        Some(len) => Ok((text[start + 1..start + 1 + len].to_string(), start + len + 2)),
        None => error("Missing a closing quote.", start),
    }
}

fn is_break(c: char) -> bool {
    c.is_whitespace() || matches!(c, '(' | ')' | '|' | '"')
}

fn lex(text: &str) -> Result<Vec<(Tok, usize)>, ParseError> {
    let mut toks = Vec::new();
    let mut i = 0;
    while let Some(c) = text[i..].chars().next() {
        let next = text[i + c.len_utf8()..].chars().next();
        match c {
            _ if c.is_whitespace() => i += c.len_utf8(),
            '(' | ')' => {
                toks.push((if c == '(' { Tok::Open } else { Tok::Close }, i));
                i += 1;
            }
            '|' => {
                toks.push((Tok::Or, i));
                i += if next == Some('|') { 2 } else { 1 };
            }
            '"' => {
                let (word, end) = read_quoted(text, i)?;
                if word.trim().is_empty() {
                    return error("A quote needs some text inside.", i);
                }
                toks.push((Tok::Word(word.to_lowercase()), i));
                i = end;
            }
            '-' if next.is_none_or(char::is_whitespace) => return error("A dash needs something after it.", i),
            '-' => {
                toks.push((Tok::Not { dash: true }, i));
                i += 1;
            }
            _ => {
                let end = text[i..].find(is_break).map_or(text.len(), |len| i + len);
                let (tok, end) = lex_bare(text, i, end)?;
                toks.push((tok, i));
                i = end;
            }
        }
    }
    Ok(toks)
}

/// Turns the bare text in `start..end` into a keyword, a field or a word; returns the token and where reading goes on.
fn lex_bare(text: &str, start: usize, end: usize) -> Result<(Tok, usize), ParseError> {
    let lower = text[start..end].to_lowercase();
    match lower.as_str() {
        "and" | "&&" => return Ok((Tok::And, end)),
        "or" => return Ok((Tok::Or, end)),
        "not" => return Ok((Tok::Not { dash: false }, end)),
        _ => {}
    }
    for (prefix, field) in FIELDS {
        if !lower.starts_with(prefix) {
            continue;
        }
        let (value, end) = if lower.len() == prefix.len() && text[end..].starts_with('"') {
            read_quoted(text, end)?
        } else {
            (lower[prefix.len()..].to_string(), end)
        };
        if value.trim().is_empty() {
            return error("A field needs a value after the colon.", start);
        }
        let value = if field == Field::Tag { tag_slug(&value) } else { value.to_lowercase() };
        return Ok((Tok::Field(field, value), end));
    }
    Ok((Tok::Word(lower), end))
}

// ---------------------------------------------------------------------------
// Parsing

struct Parser {
    toks: Vec<(Tok, usize)>,
    pos: usize,
    /// The offset just past the text, for problems at its end.
    end: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos).map(|(t, _)| t)
    }

    fn here(&self) -> usize {
        self.toks.get(self.pos).map_or(self.end, |(_, at)| *at)
    }

    /// Whether the next token can begin an operand.
    fn at_operand(&self) -> bool {
        matches!(self.peek(), Some(Tok::Open | Tok::Not { .. } | Tok::Word(_) | Tok::Field(..)))
    }

    fn or(&mut self) -> Result<Query, ParseError> {
        let mut items = vec![self.and()?];
        while self.peek() == Some(&Tok::Or) {
            let at = self.here();
            self.pos += 1;
            if !self.at_operand() {
                return error("OR needs something after it.", at);
            }
            items.push(self.and()?);
        }
        Ok(join_or(items))
    }

    fn and(&mut self) -> Result<Query, ParseError> {
        let mut items = vec![self.unary()?];
        loop {
            if self.peek() == Some(&Tok::And) {
                let at = self.here();
                self.pos += 1;
                if !self.at_operand() {
                    return error("AND needs something after it.", at);
                }
            } else if !self.at_operand() {
                break;
            }
            items.push(self.unary()?);
        }
        Ok(join_and(items))
    }

    fn unary(&mut self) -> Result<Query, ParseError> {
        let at = self.here();
        if let Some(Tok::Not { dash }) = self.peek() {
            let message = if *dash { "A dash needs something after it." } else { "NOT needs something after it." };
            self.pos += 1;
            if !self.at_operand() {
                return error(message, at);
            }
            return Ok(Query::Not(Box::new(self.unary()?)));
        }
        self.atom()
    }

    fn atom(&mut self) -> Result<Query, ParseError> {
        let at = self.here();
        let Some((tok, _)) = self.toks.get(self.pos).cloned() else {
            return error("The query ends too soon.", at);
        };
        self.pos += 1;
        match tok {
            Tok::Open => {
                if self.peek() == Some(&Tok::Close) {
                    return error("Empty parentheses.", at);
                }
                let inner = self.or()?;
                if self.peek() != Some(&Tok::Close) {
                    return error("Missing a closing parenthesis.", at);
                }
                self.pos += 1;
                Ok(inner)
            }
            Tok::Close => error("Unexpected closing parenthesis.", at),
            Tok::And => error("AND needs something before it.", at),
            Tok::Or => error("OR needs something before it.", at),
            Tok::Not { .. } => unreachable!("unary handles NOT"),
            Tok::Word(w) => Ok(Query::Term(Term::Word(w))),
            Tok::Field(Field::Tag, v) => Ok(Query::Term(Term::Tag(v))),
            Tok::Field(Field::Name, v) => Ok(Query::Term(Term::Name(v))),
            Tok::Field(Field::Path, v) => Ok(Query::Term(Term::Path(v))),
        }
    }
}

/// Joins operands into an And: one operand stands alone and a nested And is spliced in.
fn join_and(items: Vec<Query>) -> Query {
    join(items, Query::And, |q| match q {
        Query::And(inner) => Ok(inner),
        other => Err(other),
    })
}

/// Joins operands into an Or: one operand stands alone and a nested Or is spliced in.
fn join_or(items: Vec<Query>) -> Query {
    join(items, Query::Or, |q| match q {
        Query::Or(inner) => Ok(inner),
        other => Err(other),
    })
}

fn join(items: Vec<Query>, make: fn(Vec<Query>) -> Query, split: fn(Query) -> Result<Vec<Query>, Query>) -> Query {
    let mut flat = Vec::new();
    for item in items {
        match split(item) {
            Ok(inner) => flat.extend(inner),
            Err(other) => flat.push(other),
        }
    }
    if flat.len() == 1 {
        return flat.pop().expect("one item");
    }
    make(flat)
}

/// Parse a query. Text that is empty or only whitespace gives `Query::All`.
pub fn parse(text: &str) -> Result<Query, ParseError> {
    let toks = lex(text)?;
    if toks.is_empty() {
        return Ok(Query::All);
    }
    let mut parser = Parser { toks, pos: 0, end: text.len() };
    let query = parser.or()?;
    match parser.peek() {
        None => Ok(query),
        Some(_) => error("Unexpected closing parenthesis.", parser.here()),
    }
}

// ---------------------------------------------------------------------------
// Evaluation

/// What a query is evaluated against: one repository.
pub trait Facts {
    /// Whether the repository has this tag; `tag` is lowercase.
    fn has_tag(&self, tag: &str) -> bool;
    /// The repository's folder name.
    fn name(&self) -> &str;
    /// Its location: the path with `~` for the home folder.
    fn location(&self) -> &str;
}

impl Query {
    /// Whether a repository matches. `is_tag` says whether a bare word names a known tag.
    pub fn matches(&self, facts: &dyn Facts, is_tag: &dyn Fn(&str) -> bool) -> bool {
        match self {
            Query::All => true,
            Query::Term(term) => term.matches(facts, is_tag),
            Query::Not(q) => !q.matches(facts, is_tag),
            Query::And(qs) => qs.iter().all(|q| q.matches(facts, is_tag)),
            Query::Or(qs) => qs.iter().any(|q| q.matches(facts, is_tag)),
        }
    }

    /// Whether this is the empty query, which matches everything.
    pub fn is_all(&self) -> bool {
        matches!(self, Query::All)
    }
}

impl Term {
    fn matches(&self, facts: &dyn Facts, is_tag: &dyn Fn(&str) -> bool) -> bool {
        let in_name = |x: &str| facts.name().to_lowercase().contains(x);
        let in_location = |x: &str| facts.location().to_lowercase().contains(x);
        match self {
            Term::Word(w) if is_tag(w) => facts.has_tag(w),
            Term::Word(w) => in_name(w) || in_location(w),
            Term::Tag(t) => facts.has_tag(t),
            Term::Name(x) => in_name(x),
            Term::Path(x) => in_location(x),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(s: &str) -> Query {
        Query::Term(Term::Word(s.to_string()))
    }
    fn not(q: Query) -> Query {
        Query::Not(Box::new(q))
    }
    fn tag(s: &str) -> Query {
        Query::Term(Term::Tag(s.to_string()))
    }
    fn name(s: &str) -> Query {
        Query::Term(Term::Name(s.to_string()))
    }
    fn path(s: &str) -> Query {
        Query::Term(Term::Path(s.to_string()))
    }
    fn p(s: &str) -> Query {
        parse(s).unwrap_or_else(|e| panic!("{s:?} failed: {e}"))
    }
    fn err(s: &str) -> ParseError {
        parse(s).expect_err(s)
    }

    struct Repo {
        tags: Vec<&'static str>,
        name: &'static str,
        location: &'static str,
    }

    impl Facts for Repo {
        fn has_tag(&self, tag: &str) -> bool {
            self.tags.contains(&tag)
        }
        fn name(&self) -> &str {
            self.name
        }
        fn location(&self) -> &str {
            self.location
        }
    }

    const VOCAB: [&str; 8] = ["northstar", "product", "third-party", "uncommitted", "stale", "a", "b", "c"];

    fn is_tag(w: &str) -> bool {
        VOCAB.contains(&w)
    }

    fn repo(tags: &[&'static str]) -> Repo {
        Repo { tags: tags.to_vec(), name: "Meridian", location: "~/RustroverProjects/meridian" }
    }

    fn hit(query: &str, repo: &Repo) -> bool {
        p(query).matches(repo, &is_tag)
    }

    #[test]
    fn empty_is_all() {
        assert_eq!(p(""), Query::All);
        assert_eq!(p("  \t "), Query::All);
        assert!(p("").is_all());
        assert!(!p("a").is_all());
    }

    #[test]
    fn precedence_and_implicit_and() {
        assert_eq!(p("a OR b c"), Query::Or(vec![w("a"), Query::And(vec![w("b"), w("c")])]));
        assert_eq!(p("a b OR c"), Query::Or(vec![Query::And(vec![w("a"), w("b")]), w("c")]));
        assert_eq!(p("a AND b"), Query::And(vec![w("a"), w("b")]));
        assert_eq!(p("NOT a AND b"), Query::And(vec![not(w("a")), w("b")]));
    }

    #[test]
    fn flattening_and_groups() {
        assert_eq!(p("a b c"), Query::And(vec![w("a"), w("b"), w("c")]));
        assert_eq!(p("(a b) c"), Query::And(vec![w("a"), w("b"), w("c")]));
        assert_eq!(p("a AND (b AND c)"), Query::And(vec![w("a"), w("b"), w("c")]));
        assert_eq!(p("a OR (b OR c) OR d"), Query::Or(vec![w("a"), w("b"), w("c"), w("d")]));
        assert_eq!(p("(a)"), w("a"));
        assert_eq!(p("((a))"), w("a"));
        assert_eq!(p("(a OR b) c"), Query::And(vec![Query::Or(vec![w("a"), w("b")]), w("c")]));
    }

    #[test]
    fn negation() {
        assert_eq!(p("-third-party"), not(w("third-party")));
        assert_eq!(p("--a"), not(not(w("a"))));
        assert_eq!(p("-(a OR b)"), not(Query::Or(vec![w("a"), w("b")])));
        assert_eq!(p("-\"x y\""), not(w("x y")));
        assert_eq!(p("NOT NOT a"), not(not(w("a"))));
        assert_eq!(p("not a"), not(w("a")));
        assert_eq!(p("a -b"), Query::And(vec![w("a"), not(w("b"))]));
        assert_eq!(p("a AND NOT b"), Query::And(vec![w("a"), not(w("b"))]));
    }

    #[test]
    fn keywords_and_operators() {
        assert_eq!(p("a and b"), Query::And(vec![w("a"), w("b")]));
        assert_eq!(p("a Or b"), Query::Or(vec![w("a"), w("b")]));
        assert_eq!(p("a && b"), Query::And(vec![w("a"), w("b")]));
        assert_eq!(p("a | b"), Query::Or(vec![w("a"), w("b")]));
        assert_eq!(p("a || b"), Query::Or(vec![w("a"), w("b")]));
        assert_eq!(p("a|b"), Query::Or(vec![w("a"), w("b")]));
        assert_eq!(p("(a|b)c"), Query::And(vec![Query::Or(vec![w("a"), w("b")]), w("c")]));
        assert_eq!(p("android"), w("android"));
        assert_eq!(p("\"and\""), w("and"));
        assert_eq!(p("a \"OR\" b"), Query::And(vec![w("a"), w("or"), w("b")]));
    }

    #[test]
    fn words() {
        assert_eq!(p("Northstar"), w("northstar"));
        assert_eq!(p("\"My Repo\""), w("my repo"));
        assert_eq!(p("local-only"), w("local-only"));
        assert_eq!(p("a-b-c"), w("a-b-c"));
        assert_eq!(p("app:clion"), w("app:clion"));
        assert_eq!(p("lang:rust"), w("lang:rust"));
        assert_eq!(p("category:research"), w("category:research"));
    }

    #[test]
    fn fields() {
        assert_eq!(p("tag:Machine"), tag("machine"));
        assert_eq!(p("TAG:x"), tag("x"));
        assert_eq!(p("tag:\"Machine  Learning\""), tag("machine-learning"));
        assert_eq!(p("name:Merid"), name("merid"));
        assert_eq!(p("name:\"my repo\""), name("my repo"));
        assert_eq!(p("path:~/Foo"), path("~/foo"));
        assert_eq!(p("Path:\"a b\" name:x"), Query::And(vec![path("a b"), name("x")]));
        assert_eq!(p("-tag:x"), not(tag("x")));
        assert_eq!(p("(name:a|name:b)"), Query::Or(vec![name("a"), name("b")]));
    }

    #[test]
    fn errors() {
        assert_eq!(err("(a b"), ParseError { message: "Missing a closing parenthesis.".into(), at: 0 });
        assert_eq!(err("a (b").at, 2);
        assert_eq!(err("a b)"), ParseError { message: "Unexpected closing parenthesis.".into(), at: 3 });
        assert_eq!(err(")a").message, "Unexpected closing parenthesis.");
        assert_eq!(err("()").message, "Empty parentheses.");
        assert_eq!(err("a ()").at, 2);
        assert_eq!(err("a AND"), ParseError { message: "AND needs something after it.".into(), at: 2 });
        assert_eq!(err("a OR").message, "OR needs something after it.");
        assert_eq!(err("a OR )").message, "OR needs something after it.");
        assert_eq!(err("NOT"), ParseError { message: "NOT needs something after it.".into(), at: 0 });
        assert_eq!(err("a NOT").at, 2);
        assert_eq!(err("-"), ParseError { message: "A dash needs something after it.".into(), at: 0 });
        assert_eq!(err("a - b").at, 2);
        assert_eq!(err("(a -)").message, "A dash needs something after it.");
        assert_eq!(err("AND a"), ParseError { message: "AND needs something before it.".into(), at: 0 });
        assert_eq!(err("a OR OR b").message, "OR needs something after it.");
        assert_eq!(err("(OR a)").message, "OR needs something before it.");
        assert_eq!(err("OR a"), ParseError { message: "OR needs something before it.".into(), at: 0 });
        assert_eq!(err("a \"b c"), ParseError { message: "Missing a closing quote.".into(), at: 2 });
        assert_eq!(err("name:\"b").message, "Missing a closing quote.");
        assert_eq!(err("tag:"), ParseError { message: "A field needs a value after the colon.".into(), at: 0 });
        assert_eq!(err("a name:").at, 2);
        assert_eq!(err("path:\"\"").message, "A field needs a value after the colon.");
        assert_eq!(err("\"\"").message, "A quote needs some text inside.");
        assert_eq!(err("(a b").to_string(), "Missing a closing parenthesis.");
    }

    #[test]
    fn evaluates_tags() {
        let northstar = repo(&["northstar", "product"]);
        let both = repo(&["northstar", "product", "third-party"]);
        let q = "northstar AND product AND NOT third-party";
        assert!(hit(q, &northstar));
        assert!(!hit(q, &both));
        assert!(hit("-third-party", &northstar));
        assert!(!hit("-third-party", &both));
    }

    #[test]
    fn implicit_and_matches_explicit() {
        let both = repo(&["uncommitted", "stale"]);
        let one = repo(&["uncommitted"]);
        for q in ["uncommitted AND stale", "uncommitted stale"] {
            assert!(hit(q, &both));
            assert!(!hit(q, &one));
        }
    }

    #[test]
    fn groups_and_negation() {
        assert!(hit("(a OR b) -c", &repo(&["a"])));
        assert!(hit("(a OR b) -c", &repo(&["b"])));
        assert!(!hit("(a OR b) -c", &repo(&["a", "c"])));
        assert!(!hit("(a OR b) -c", &repo(&["c"])));
        assert!(hit("--a", &repo(&["a"])));
        assert!(!hit("NOT NOT a", &repo(&[])));
    }

    #[test]
    fn bare_words() {
        let r = repo(&["northstar"]);
        assert!(hit("merid", &r));
        assert!(hit("rustrover", &r));
        assert!(hit("MERIDIAN", &r));
        assert!(!hit("sextant", &r));
        // A known tag does not match by name or location, only by tag.
        assert!(!hit("product", &Repo { tags: vec![], name: "product-site", location: "~/product" }));
        assert!(hit("product", &repo(&["product"])));
        let spaced = Repo { tags: vec![], name: "My Repo", location: "~/x" };
        assert!(hit("\"my repo\"", &spaced));
    }

    #[test]
    fn fields_evaluate() {
        let r = repo(&["northstar"]);
        assert!(hit("tag:northstar", &r));
        assert!(hit("tag:Northstar", &r));
        assert!(!hit("tag:product", &r));
        // `tag:x` works for a tag outside the vocabulary, and a bare word does not.
        let odd = repo(&["unknown"]);
        assert!(hit("tag:unknown", &odd));
        assert!(!hit("unknown", &odd));
        assert!(hit("name:rid", &r));
        assert!(!hit("name:rustrover", &r));
        assert!(hit("path:rustrover", &r));
        assert!(hit("path:~/Rust", &r));
        assert!(!hit("path:xyz", &r));
        assert!(hit("name:MERID", &r));
    }

    #[test]
    fn empty_matches_everything() {
        assert!(hit("", &repo(&[])));
        assert!(hit("   ", &repo(&["a"])));
    }
}
