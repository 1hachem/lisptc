" Syntax highlighting for lisptc (.ptc).
"
" Only the parenthesised top-level forms are program text: the interpreter
" evaluates those and ignores everything around them (the dialect has no
" comment syntax -- the prose IS the comment). So the buffer is highlighted
" inside out: prose gets the Comment colour, and code gets the stock lisp
" syntax, which is close enough to this dialect.

if exists("b:current_syntax")
  finish
endif

syn include @lisptcCode syntax/lisp.vim
unlet! b:current_syntax

" `;` is an ordinary symbol character here, so nothing in a form is a comment.
silent! syn clear lispComment
silent! syn clear lispCommentRegion

" A top-level form. Nested parens are handled by the included lisp syntax.
syn region lisptcForm matchgroup=lisptcParen start="(" end=")"
      \ contains=@lisptcCode,lisptcForm

" Reader sugar written against a form ('(a b), `(a ,b), ,@(a)) is code, not
" prose: the interpreter reads it as part of the form.
syn match lisptcSugar "[`',@]\+\ze("

" Free text around the forms. It stops before a "(" -- that opens a form --
" and before the sugar above, which it would otherwise swallow (a match already
" in progress wins over one starting later). A ")" out here closes nothing, so
" it is prose like any other character: that is what makes ":)" harmless.
syn match lisptcProse "\%(\%([`',@]*(\)\@![^(]\)\+"

hi def link lisptcProse Comment
hi def link lisptcParen Delimiter
hi def link lisptcSugar Special

" A form can span many lines, and prose is only prose because no form is open,
" so highlighting has to be decided from the top of the file.
syn sync fromstart

let b:current_syntax = "lisptc"
