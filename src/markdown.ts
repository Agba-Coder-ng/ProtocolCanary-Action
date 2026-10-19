/**
 * Markdown escaping and safe rendering helpers for engine-provided text.
 *
 * All text that originates from the engine (the report) must be rendered as
 * inert text in the job summary — GitHub's Markdown renderer must never
 * interpret link syntax, images, headings, table delimiters, autolinked URLs,
 * issue references, @mentions, or HTML from these strings. The helpers in this
 * module implement that guarantee while keeping ordinary text, non-ASCII
 * letters, emoji, punctuation inside words, and paths readable.
 *
 * CommonMark references:
 * - Code spans: §6.2 (backtick strings, delimiter length > interior runs)
 * - Fenced code blocks: §4.8 (fence length > interior runs, closing fence equals
 *   opening fence length)
 * - Autolinks: §6.5 (absolute URIs, www. links, email addresses)
 * - HTML: §6.1 (raw HTML is passed through unless escaped)
 */

// Characters that have special meaning in Markdown inline context and must be
// backslash-escaped when they would otherwise be interpreted. This list covers
// the characters that start Markdown constructs in inline content.
const INLINE_SPECIAL = /[\\`*_\[\]{}()#+\-.!|<>~]/g;

/** Matches a bare URL that GitHub would autolink (http(s)://...). */
const AUTOLINK_URL = /\bhttps?:\/\/[^\s<>"'`]+/g;

/** Matches a www. autolink (www.example.com/path). */
const AUTOLINK_WWW = /\bwww\.[^\s<>"'`]+/g;

/** Matches an email autolink (user@example.com). */
const AUTOLINK_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Matches a GitHub @mention autolink (@username). */
const AUTOLINK_MENTION = /\B@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?\b/g;

/** Matches a GitHub issue/PR reference autolink (#123). */
const AUTOLINK_ISSUE = /\B#[1-9]\d*\b/g;

/**
 * Escapes a single-line string for safe inline Markdown rendering.
 *
 * Rules applied:
 * 1. Collapse newlines and tabs to spaces (inline content must not contain
 *    literal newlines).
 * 2. Backslash-escape Markdown-significant characters (\ ` * _ { } [ ] ( ) # + - . ! | < > ~).
 * 3. Neutralise autolinks (bare URLs, www. links, email addresses, @mentions,
 *    #issue references) by inserting a zero-width space (U+200B) after the
 *    first character, which breaks the autolink pattern while remaining
 *    invisible when rendered.
 *
 * The result is safe to interpolate directly into Markdown inline content
 * (table cells, list items, paragraph text) without being interpreted as
 * Markdown syntax.
 */
export function escapeInline(text: string): string {
  if (text === "") {
    return "";
  }
  // Collapse newlines and tabs to spaces
  let escaped = text.replace(/[\n\t\r]+/g, " ");
  // Backslash-escape Markdown special characters
  escaped = escaped.replace(INLINE_SPECIAL, "\\$&");
  // Neutralise autolinks by inserting zero-width space after first char
  // Order matters: URLs first, then www, then email, then @mention, then #issue
  escaped = escaped.replace(AUTOLINK_URL, (m) => m[0] + "\u200B" + m.slice(1));
  escaped = escaped.replace(AUTOLINK_WWW, (m) => m[0] + "\u200B" + m.slice(1));
  escaped = escaped.replace(AUTOLINK_EMAIL, (m) => m[0] + "\u200B" + m.slice(1));
  escaped = escaped.replace(AUTOLINK_MENTION, (m) => m[0] + "\u200B" + m.slice(1));
  escaped = escaped.replace(AUTOLINK_ISSUE, (m) => m[0] + "\u200B" + m.slice(1));
  return escaped;
}

/**
 * Builds a Markdown code span (backtick-delimited) that safely contains
 * `text` without the content being interpreted as Markdown.
 *
 * Per CommonMark §6.2, a code span is delimited by a run of backticks that is
 * strictly longer than any run of backticks inside the content. The delimiter
 * is padded with a single space when the content starts or ends with a
 * backtick.
 *
 * This function chooses the minimal delimiter length that satisfies the rule,
 * with a minimum of 1 backtick (for content without backticks) and a maximum
 * of 10 (practically never reached).
 */
export function codeSpan(text: string): string {
  // Find the longest run of backticks in the content
  const backtickRuns = text.match(/`+/g);
  const longestRun = backtickRuns ? Math.max(...backtickRuns.map((run) => run.length)) : 0;
  // Delimiter must be strictly longer than the longest interior run
  const delimiterLength = Math.max(1, longestRun + 1);
  const delimiter = "`".repeat(delimiterLength);

  // Pad with spaces if content starts or ends with a backtick
  const needsPadding = text.startsWith("`") || text.endsWith("`");
  const content = needsPadding ? ` ${text} ` : text;

  return `${delimiter}${content}${delimiter}`;
}

/**
 * Builds a fenced code block (CommonMark §4.8) that safely contains `text`
 * without the content being interpreted as Markdown.
 *
 * The fence length is chosen to be strictly longer than any run of backticks
 * in the content, with a minimum of 3 and a practical maximum of 20. This
 * ensures the content cannot close the fence early.
 *
 * The fence uses the ````text```` info string convention so the content is
 * treated as plain text (no syntax highlighting that might misinterpret
 * content).
 */
export function fencedBlock(text: string): string {
  // Find the longest run of backticks in the content
  const backtickRuns = text.match(/`+/g);
  const longestRun = backtickRuns ? Math.max(...backtickRuns.map((run) => run.length)) : 0;
  // Fence must be strictly longer than the longest interior run; minimum 3
  const fenceLength = Math.max(3, longestRun + 1);
  const fence = "`".repeat(fenceLength);

  // Ensure content doesn't start/end with a fence-like line
  // (a line that is exactly the fence or starts with the fence)
  const lines = text.split("\n");
  const startsWithFence = lines[0]?.startsWith(fence) ?? false;
  const endsWithFence = lines[lines.length - 1]?.startsWith(fence) ?? false;
  const needsNewlines = startsWithFence || endsWithFence;
  const content = needsNewlines ? `\n${text}\n` : text;

  return `${fence}text\n${content}\n${fence}`;
}