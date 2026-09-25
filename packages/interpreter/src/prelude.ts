export const prelude = `
(setq defmacro
      (macro (name args &rest body)
             \`(progn (setq ,name (macro ,args ,@body))
                     (_set-doc ',name ',args ,(cond ((stringp (car body)) (car body))))
                     ',name)))
(_set-doc 'defmacro "(defmacro name (arg...) [docstring] body...)"
          "Define a global macro named name. A leading docstring is registered as its documentation.")

(defmacro defun (name args &rest body)
  "Define a global function named name. A leading docstring is registered as its documentation; use &rest for variadic arguments."
  \`(progn (setq ,name (lambda ,args ,@body))
          (_set-doc ',name ',args ,(cond ((stringp (car body)) (car body))))
          ',name))

(defun caar (x)
  "(car (car x))" (car (car x)))
(defun cadr (x)
  "(car (cdr x)) - the second element of a list." (car (cdr x)))
(defun cdar (x)
  "(cdr (car x))" (cdr (car x)))
(defun cddr (x)
  "(cdr (cdr x))" (cdr (cdr x)))
(defun caaar (x)
  "(car (car (car x)))" (car (car (car x))))
(defun caadr (x)
  "(car (car (cdr x)))" (car (car (cdr x))))
(defun cadar (x)
  "(car (cdr (car x)))" (car (cdr (car x))))
(defun caddr (x)
  "(car (cdr (cdr x))) - the third element of a list." (car (cdr (cdr x))))
(defun cdaar (x)
  "(cdr (car (car x)))" (cdr (car (car x))))
(defun cdadr (x)
  "(cdr (car (cdr x)))" (cdr (car (cdr x))))
(defun cddar (x)
  "(cdr (cdr (car x)))" (cdr (cdr (car x))))
(defun cdddr (x)
  "(cdr (cdr (cdr x)))" (cdr (cdr (cdr x))))
(defun not (x)
  "Return t if x is nil. Alias: null." (eq x nil))
(defun consp (x)
  "Return t if x is a cons cell (a non-empty list)." (not (atom x)))
(defun identity (x)
  "Return x unchanged." x)

(setq
 = eql
 rem %
 null not
 setcar rplaca
 setcdr rplacd)
(_set-doc '= "(= x y)" "Return t if x and y are numerically equal (alias of eql).")
(_set-doc 'rem "(rem x y)" "Return the remainder of x divided by y (alias of %).")
(_set-doc 'null "(null x)" "Return t if x is nil (alias of not).")
(_set-doc 'setcar "(setcar cell x)" "Destructively set the car of cell to x (alias of rplaca).")
(_set-doc 'setcdr "(setcdr cell x)" "Destructively set the cdr of cell to x (alias of rplacd).")

(defun > (x y)
  "Return t if x is numerically greater than y." (< y x))
(defun >= (x y)
  "Return t if x is greater than or equal to y." (not (< x y)))
(defun <= (x y)
  "Return t if x is less than or equal to y." (not (< y x)))
(defun /= (x y)
  "Return t if x and y are not numerically equal." (not (= x y)))

(defun equal (x y)
  "Return t if x and y are structurally equal (recursing into lists)."
  (cond ((atom x) (eql x y))
        ((atom y) nil)
        ((equal (car x) (car y)) (equal (cdr x) (cdr y)))))

(defmacro if (test then &rest else)
  "If test is non-nil, evaluate then; otherwise evaluate the else forms."
  \`(cond (,test ,then)
         ,@(cond (else \`((t ,@else))))))

(defmacro when (test &rest body)
  "If test is non-nil, evaluate body and return its last value."
  \`(cond (,test ,@body)))

(defmacro unless (test &rest body)
  "If test is nil, evaluate body and return its last value."
  \`(cond ((not ,test) ,@body)))

(defmacro let (args &rest body)
  "Bind variables in parallel, then evaluate body. A bare name binds to nil."
  ((lambda (vars vals)
     (defun vars (x)
       (cond (x (cons (if (atom (car x))
                          (car x)
                        (caar x))
                      (vars (cdr x))))))
     (defun vals (x)
       (cond (x (cons (if (atom (car x))
                          nil
                        (cadar x))
                      (vals (cdr x))))))
     \`((lambda ,(vars args) ,@body) ,@(vals args)))
   nil nil))

(defmacro letrec (args &rest body)
  "Like let, but bindings may refer to each other (e.g. for local recursive functions)."
  (let (vars sets)
    (defun vars (x)
      (cond (x (cons (caar x)
                     (vars (cdr x))))))
    (defun sets (x)
      (cond (x (cons \`(setq ,(caar x) ,(cadar x))
                     (sets (cdr x))))))
    \`(let ,(vars args) ,@(sets args) ,@body)))

(defmacro let* (args &rest body)
  "Like let, but the bindings happen in sequence, so each one can use the values bound before it."
  (let (nest)
    (defun nest (bs)
      (if (null bs)
          \`(let () ,@body)
        \`(let (,(car bs)) ,(nest (cdr bs)))))
    (nest args)))

(defun _append (x y)
  (if (null x)
      y
    (cons (car x) (_append (cdr x) y))))
(defmacro append (x &rest y)
  "Return the concatenation of the given lists (copies all but the last)."
  (if (null y)
      x
    \`(_append ,x (append ,@y))))

(defmacro and (x &rest y)
  "Evaluate left to right; return nil on the first nil value, else the last value."
  (if (null y)
      x
    \`(cond (,x (and ,@y)))))

(defun mapcar (f x)
  "Return a new list of f applied to each element of x."
  (and x (cons (f (car x)) (mapcar f (cdr x)))))

(defun nth (n x)
  "Return the element of the list x at index n, counting from 0; nil if n is past the end."
  (cond ((null x) nil)
        ((< n 0) nil)
        ((< n 1) (car x))
        (t (nth (- n 1) (cdr x)))))

(defun filter (f x)
  "Return a new list of the elements of x for which f returns non-nil."
  (cond ((null x) nil)
        ((f (car x)) (cons (car x) (filter f (cdr x))))
        (t (filter f (cdr x)))))

(defun _reduce (f acc x)
  (if (null x)
      acc
    (_reduce f (f acc (car x)) (cdr x))))
(defun reduce (f list &rest initial)
  "Fold list left to right into one value: call f with the accumulator and each element in turn. Without an initial value the first element starts the fold, and an empty list gives nil. (reduce + '(1 2 3)) is 6."
  (cond ((not (listp list))
         (error "reduce: the list comes second and the initial value last, as (reduce f list [initial])"))
        (initial (_reduce f (car initial) list))
        ((null list) nil)
        (t (_reduce f (car list) (cdr list)))))

(defmacro or (x &rest y)
  "Evaluate left to right; return the first non-nil value, else nil."
  (if (null y)
      x
    \`(cond (,x)
           ((or ,@y)))))

(defun listp (x)
  "Return t if x is a list (nil or a cons cell)."
  (or (null x) (consp x)))

(defun memq (key x)
  "Return the tail of x whose car is eq to key, or nil."
  (cond ((null x) nil)
        ((eq key (car x)) x)
        (t (memq key (cdr x)))))

(defun member (key x)
  "Return the tail of x whose car is equal to key, or nil."
  (cond ((null x) nil)
        ((equal key (car x)) x)
        (t (member key (cdr x)))))

(defun assq (key alist)
  "Return the first pair of alist whose car is eq to key, or nil."
  (cond (alist (let ((e (car alist)))
                 (if (and (consp e) (eq key (car e)))
                     e
                   (assq key (cdr alist)))))))

(defun assoc (key alist)
  "Return the first pair of alist whose car is equal to key, or nil."
  (cond (alist (let ((e (car alist)))
                 (if (and (consp e) (equal key (car e)))
                     e
                   (assoc key (cdr alist)))))))

(defun _key-name (key)
  (let ((name (string key)))
    (if (string-prefix? ":" name)
        (substring name 1)
      name)))
(defun _alist-get (key alist)
  (let ((hit (assoc key alist)))
    (cond (hit (cdr hit))
          ((stringp key) nil)
          (t (cdr (assoc (_key-name key) alist))))))
(defun get-in (record &rest keys)
  "Read a value out of nested alists and lists: each key is an alist key, or a number to index a list. Every step is guarded, so a missing key or a nil along the way gives nil instead of an error: (get-in config \\"server\\" \\"port\\"), (get-in reply \\"results\\" 0 \\"url\\"). A symbol or keyword key also matches the string of its name, so :port finds \\"port\\"."
  (let ((value record))
    (dolist (key keys value)
      (setq value (cond ((not (consp value)) nil)
                        ((numberp key) (nth key value))
                        (t (_alist-get key value)))))))

(defun _nreverse (x prev)
  (let ((next (cdr x)))
    (setcdr x prev)
    (if (null next)
        x
      (_nreverse next x))))
(defun nreverse (list)
  "Reverse list destructively; return the reversed list."
  (cond (list (_nreverse list nil))))

(defun last (list)
  "Return the last cons cell of list."
  (if (atom (cdr list))
      list
    (last (cdr list))))

(defun nconc (&rest lists)
  "Concatenate the lists destructively; return the result."
  (if (null (cdr lists))
      (car lists)
    (if (null (car lists))
        (apply nconc (cdr lists))
      (setcdr (last (car lists))
              (apply nconc (cdr lists)))
      (car lists))))

(defmacro while (test &rest body)
  "Loop: evaluate body while test is non-nil; return nil, or (return value)'s value if given; (break) also ends the loop early, returning nil."
  (let ((loop (gensym))
        (signal (gensym)))
    \`(letrec ((,loop (lambda ()
                        (cond (,test
                               (let ((,signal (_run-loop-body (lambda () ,@body))))
                                 (if (car ,signal)
                                     (cdr ,signal)
                                   (,loop))))))))
       (,loop))))

(defmacro dolist (spec &rest body)
  "Evaluate body with name (car of spec) bound to each element of the list (cadr of spec); return the optional third element of spec, or a (break)/(return value)'s outcome if the loop is interrupted (skipping the result form)."
  (let ((name (car spec))
        (list (gensym))
        (loop (gensym))
        (signal (gensym)))
    \`(let (,name
           (,list ,(cadr spec)))
       (letrec ((,loop (lambda ()
                          (cond (,list
                                 (setq ,name (car ,list))
                                 (let ((,signal (_run-loop-body (lambda () ,@body))))
                                   (if (car ,signal)
                                       (cdr ,signal)
                                     (progn (setq ,list (cdr ,list))
                                            (,loop)))))
                                (t ,@(if (cddr spec)
                                         \`((setq ,name nil) ,(caddr spec))
                                       '(nil)))))))
         (,loop)))))

(defmacro dotimes (spec &rest body)
  "Evaluate body with name (car of spec) bound to 0..count-1; return the optional third element of spec, or a (break)/(return value)'s outcome if the loop is interrupted (skipping the result form)."
  (let ((name (car spec))
        (count (gensym))
        (loop (gensym))
        (signal (gensym)))
    \`(let ((,name 0)
           (,count ,(cadr spec)))
       (letrec ((,loop (lambda ()
                          (cond ((< ,name ,count)
                                 (let ((,signal (_run-loop-body (lambda () ,@body))))
                                   (if (car ,signal)
                                       (cdr ,signal)
                                     (progn (setq ,name (+ ,name 1))
                                            (,loop)))))
                                (t ,@(if (cddr spec)
                                         \`(,(caddr spec))
                                       '(nil)))))))
         (,loop)))))

(defmacro case (key-expr &rest clauses)
  "CL-style case: (case key-expr (keylist forms...)... (t forms...)). Evaluates key-expr once and runs the forms of the first clause whose keylist (a list of keys, or a single non-list key) contains a value equal to it; a clause headed by the symbol t is the default and always matches (wrap it in a list, e.g. ((t) ...), to use t as a literal key instead). Returns nil if no clause matches."
  (let ((key (gensym))
        expand)
    (defun expand (cls)
      (cond ((null cls) nil)
            (t (cons (if (eq (caar cls) t)
                         \`(t ,@(cdar cls))
                       \`((member ,key ',(if (consp (caar cls)) (caar cls) (list (caar cls))))
                         ,@(cdar cls)))
                     (expand (cdr cls))))))
    \`(let ((,key ,key-expr))
       (cond ,@(expand clauses)))))

(defmacro think (&rest body)
  "(think part...) Print reasoning as narration: each part prints literally, except a comma-unquoted part (or a ,@ splice), which is evaluated first so the trace is grounded in real values instead of guesses. Ends with a newline and returns nil -- put your actual answer in a separate expression, not inside think."
  (list 'progn
        (list 'apply 'echo (list 'quasiquote body))
        nil))

(defun substring (s start &rest end)
  "Return the substring of s from index start up to (but not including) end (default: end of s)."
  (let ((stop (if end (car end) (length s)))
        (out ""))
    (while (< start stop)
      (setq out (concat out (char s start)))
      (setq start (+ start 1)))
    out))

(defun string= (s1 s2)
  "Return t if the strings s1 and s2 have the same characters in the same order (alias of equal)."
  (equal s1 s2))

(defun string-prefix? (prefix s)
  "Return t if the string s starts with prefix."
  (and (<= (length prefix) (length s))
       (equal prefix (substring s 0 (length prefix)))))

(defun string-suffix? (suffix s)
  "Return t if the string s ends with suffix."
  (and (<= (length suffix) (length s))
       (equal suffix (substring s (- (length s) (length suffix))))))

(defun string-index (s sub &rest start)
  "Return the index of the first occurrence of sub in s at or after start (default 0), or nil."
  (let ((i (if start (car start) 0))
        (last (- (length s) (length sub)))
        (found nil))
    (while (and (null found) (<= i last))
      (if (equal sub (substring s i (+ i (length sub))))
          (setq found i)
        (setq i (+ i 1))))
    found))

(defun string-contains? (s sub)
  "Return t if s contains the substring sub."
  (and (string-index s sub) t))

(defun string-count (s sub)
  "Return the number of non-overlapping occurrences of sub in s."
  (if (equal sub "")
      (+ (length s) 1)
    (let ((i 0)
          (n 0)
          (pos nil))
      (while (setq pos (string-index s sub i))
        (setq n (+ n 1))
        (setq i (+ pos (length sub))))
      n)))

(defun string-replace (s old new)
  "Return s with every occurrence of the substring old replaced by new."
  (if (equal old "")
      s
    (let ((out "")
          (i 0)
          (pos nil))
      (while (setq pos (string-index s old i))
        (setq out (concat out (substring s i pos) new))
        (setq i (+ pos (length old))))
      (concat out (substring s i)))))

(defun string-split (s sep)
  "Split s on the separator string sep and return a list of strings; an empty sep splits into characters."
  (if (equal sep "")
      (let ((chars nil)
            (i (length s)))
        (while (< 0 i)
          (setq i (- i 1))
          (setq chars (cons (char s i) chars)))
        chars)
    (let ((parts nil)
          (i 0)
          (pos nil))
      (while (setq pos (string-index s sep i))
        (setq parts (cons (substring s i pos) parts))
        (setq i (+ pos (length sep))))
      (nreverse (cons (substring s i) parts)))))

(defun string-join (list sep)
  "Join the strings in list into one string separated by sep."
  (cond ((null list) "")
        ((null (cdr list)) (car list))
        (t (concat (car list) sep (string-join (cdr list) sep)))))

(defun _whitespace? (c)
  (or (equal c " ") (equal c "\\t") (equal c "\\n") (equal c "\\r")))
(defun string-trim (s)
  "Return s with leading and trailing whitespace removed."
  (let ((start 0)
        (end (length s)))
    (while (and (< start end) (_whitespace? (char s start)))
      (setq start (+ start 1)))
    (while (and (< start end) (_whitespace? (char s (- end 1))))
      (setq end (- end 1)))
    (substring s start end)))

(defun format (template &rest args)
  "Fill template with args and return the string: ~a inserts the next argument as (string x), ~% a newline, ~~ a tilde. Directives are case-insensitive."
  (let ((out "")
        (i 0)
        (n (length template))
        (pending args))
    (while (< i n)
      (let ((c (char template i)))
        (cond ((not (equal c "~"))
               (setq out (concat out c))
               (setq i (+ i 1)))
              ((<= n (+ i 1))
               (error "format: a ~ ends the template"))
              (t (let ((d (string-downcase (char template (+ i 1)))))
                   (cond ((equal d "a")
                          (when (null pending)
                            (error "format: not enough arguments for the template"))
                          (setq out (concat out (string (car pending))))
                          (setq pending (cdr pending)))
                         ((equal d "%") (setq out (concat out "\\n")))
                         ((equal d "~") (setq out (concat out "~")))
                         (t (error (concat "format: unknown directive ~" d))))
                   (setq i (+ i 2)))))))
    out))
`;
