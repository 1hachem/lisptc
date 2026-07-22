; Topiary formatting queries for Lisptc (.ptc) — a Common-Lisp-like Lisp.
;
; Strategy: Topiary does NOT reflow s-expressions semantically (that would
; need per-form indentation rules for defun/let/if/... ). Instead it respects
; the author's own line layout via `input_softline` — a gap between two
; elements becomes a newline iff the author wrote one there, and a single
; space otherwise. We then fix: spacing between tokens, indentation depth, the
; glueing of the head to `(` and of `)` to the last element, and blank-line /
; comment handling.

; Atoms are leaves: preserve their text verbatim (without this, Topiary drops
; the inner text of nodes that have named children, e.g. string contents).
[
  (str_lit)
  (num_lit)
  (sym_lit)
  (kwd_lit)
  (nil_lit)
  (comment)
] @leaf

; --- Top level -------------------------------------------------------------

; One form per line at the top level; keep the author's blank-line grouping.
(source
  (_) @append_hardline @allow_blank_line_before
)

; --- Lists -----------------------------------------------------------------

; Indent the list body one step relative to its opening paren. The head stays
; glued to `(` and `)` hugs the last element (no softline next to the parens).
(list_lit
  .
  "(" @append_indent_start
)
(list_lit
  ")" @prepend_indent_end
  .
)

; Between adjacent elements: a newline where the author wrote one, else a
; single space. This preserves the author's chosen layout (e.g. keyword/value
; pairs kept on one line) instead of collapsing or exploding it.
(list_lit
  (_) @append_input_softline
  .
  (_)
)

; `defun` is a dedicated node in this grammar (it wraps its own parens and a
; `defun_header`), so it needs the same delimiter/spacing treatment.
(defun
  .
  "(" @append_indent_start
)
(defun
  ")" @prepend_indent_end
  .
)
(defun
  (_) @append_input_softline
  .
  (_)
)

; Inside the defun header keep `defun name (args...)` on one line.
(defun_header
  (_) @append_space
  .
  (_)
)

; --- Comments --------------------------------------------------------------

; Standalone comments sit on their own line; allow the author's blank lines
; above them.
(comment) @prepend_input_softline @allow_blank_line_before
