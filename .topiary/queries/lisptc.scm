; Topiary formatting queries for Lisptc (.ptc). The grammar they run against is
; tree-sitter-lisptc/grammar.js.
;
; Strategy: Topiary does NOT reflow s-expressions semantically (that would
; need per-form indentation rules for defun/let/if/... ). Instead it respects
; the author's own line layout via `input_softline` — a gap between two
; elements becomes a newline iff the author wrote one there, and a single
; space otherwise. We then fix: spacing between tokens, indentation depth, and
; the glueing of the head to `(` and of `)` to the last element.
;
; Prose is barely formatted at all: the grammar hands a whole run of it over as
; one node, and `@leaf` keeps that node's text as written — nothing here can
; move a comma, reindent a line or reinterpret a `;`, because nothing here can
; see one. The only mark a run leaves on prose is a single space where a word
; sat flush against a paren, which is inert: reader sugar only reads as sugar
; when it touches the paren it opens.
;
; Every `input_softline` below is captured on the preceding element's last
; *token*: on the element itself when it is an atom or a string, on the closing
; paren when it is a nested form. Topiary reads the input's line break off a
; leaf, so capturing the form node instead silently drops the author's newline.

; --- Prose ----------------------------------------------------------------

; A whole run of prose is one node, kept verbatim: its own line breaks, blank
; lines and indentation are inside the node, so nothing reflows it.
(prose) @leaf

; --- Top level -------------------------------------------------------------

; Keep the author's blank-line grouping.
(source
  (_) @allow_blank_line_before
)

(source
  (prose) @append_input_softline
)
(source
  (form
    (close) @append_input_softline
    .
  )
)

; --- Forms -----------------------------------------------------------------

; Indent the body one step relative to its opening paren. The head stays glued
; to `(` and `)` hugs the last element (no softline next to the parens).
(form
  .
  (open) @append_indent_start
)
(form
  (close) @prepend_indent_end
  .
)

; Between adjacent elements: a newline where the author wrote one, else a
; single space. This preserves the author's chosen layout (e.g. keyword/value
; pairs kept on one line) instead of collapsing or exploding it.
(form
  [(atom) (string)] @append_input_softline
  .
  [(form) (atom) (string)]
)
(form
  (form
    (close) @append_input_softline
    .
  )
  .
  [(form) (atom) (string)]
)

; --- try / catch -----------------------------------------------------------

; Unlike everything else here we force `try`'s layout rather than following the
; author's softline: `try`, the tried form, and the catch clause each always
; get their own line, regardless of how the source was written. `#eq?` on a
; capture doubles as both the predicate check and the formatting directive,
; since Topiary requires every capture name in a query to be a real directive —
; there's no predicate-only capture.
(form
  .
  (open)
  .
  (atom) @append_hardline
  .
  [(form) (atom) (string)]
  .
  (form
    .
    (open)
    .
    (atom) @append_space
    (#eq? @append_space "catch")
  ) @prepend_hardline
  .
  (close)
  .
  (#eq? @append_hardline "try")
)

; Inside `catch`, keep `catch (var)` glued together and put the first handler
; form on its own line — but only when a handler form is actually present, so
; `(catch (e))` doesn't get a dangling blank line.
(form
  .
  (open)
  .
  (atom) @append_space
  .
  (form) @append_hardline
  .
  (_)
  (#eq? @append_space "catch")
)
