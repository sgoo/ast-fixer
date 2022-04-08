/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.
  https://github.com/mishoo/UglifyJS2

  -------------------------------- (C) ---------------------------------

                           Author: Mihai Bazon
                         <mihai.bazon@gmail.com>
                       http://mihai.bazon.net/blog

  Distributed under the BSD license:

    Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:

        * Redistributions of source code must retain the above
          copyright notice, this list of conditions and the following
          disclaimer.

        * Redistributions in binary form must reproduce the above
          copyright notice, this list of conditions and the following
          disclaimer in the documentation and/or other materials
          provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
    EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
    PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
    OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
    PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
    PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
    TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
    THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
    SUCH DAMAGE.

 ***********************************************************************/

import {
    HOP,
    MAP,
    noop
} from "./utils/index.js";
import { parse } from "./parse.js";

const has_tok_flag = (tok, flag) => Boolean(tok.flags & flag);
const set_tok_flag = (tok, flag, truth) => {
    if (truth) {
        tok.flags |= flag;
    } else {
        tok.flags &= ~flag;
    }
};

const TOK_FLAG_NLB          = 0b0001;
const TOK_FLAG_QUOTE_SINGLE = 0b0010;
const TOK_FLAG_QUOTE_EXISTS = 0b0100;

class AST_Token {
    constructor(type, value, line, col, pos, nlb, comments_before, comments_after, file) {
        this.flags = (nlb ? 1 : 0);

        this.type = type;
        this.value = value;
        this.line = line;
        this.col = col;
        this.pos = pos;
        this.comments_before = comments_before;
        this.comments_after = comments_after;
        this.file = file;

        Object.seal(this);
    }

    get nlb() {
        return has_tok_flag(this, TOK_FLAG_NLB);
    }

    set nlb(new_nlb) {
        set_tok_flag(this, TOK_FLAG_NLB, new_nlb);
    }

    get quote() {
        return !has_tok_flag(this, TOK_FLAG_QUOTE_EXISTS)
            ? ""
            : (has_tok_flag(this, TOK_FLAG_QUOTE_SINGLE) ? "'" : '"');
    }

    set quote(quote_type) {
        set_tok_flag(this, TOK_FLAG_QUOTE_SINGLE, quote_type === "'");
        set_tok_flag(this, TOK_FLAG_QUOTE_EXISTS, !!quote_type);
    }
}

class AST_Node {
    static TYPE = "Node";
    TYPE = "Node";
    CTOR = AST_Node;
    static documentation = "Base class of all AST nodes";

    static propdoc = {
        start: "[AST_Token] The first token of this node",
        end: "[AST_Token] The last token of this node"
    };

    constructor(props) {
        this.flags = 0;

        if (props) {
            this.start = props.start;
            this.end = props.end;
        }
    }

    _clone(deep) {
        if (deep) {
            var self = this.clone();
            return self.transform(new TreeTransformer(function(node) {
                if (node !== self) {
                    return node.clone(true);
                }
            }));
        }
        return new this.CTOR(this);
    }

    clone(deep) {
        return this._clone(deep);
    }

    _walk(visitor) {
        return visitor._visit(this);
    }

    walk(visitor) {
        return this._walk(visitor); // not sure the indirection will be any help
    }

    _children_backwards() {}

    static DEFMETHOD(name, method) {
        this.prototype[name] = method;
    }
}

class AST_Statement extends AST_Node {
    static TYPE = "Statement";
    TYPE = "Statement";
    CTOR = AST_Statement;
    static documentation = "Base class of all statements";

    constructor(props) {
        super(props);
    }
}

class AST_Debugger extends AST_Statement {
    static TYPE = "Debugger";
    TYPE = "Debugger";
    CTOR = AST_Debugger;
    static documentation = "Represents a debugger statement";

    constructor(props) {
        super(props);
    }
}

class AST_Directive extends AST_Statement {
    static TYPE = "Directive";
    TYPE = "Directive";
    CTOR = AST_Directive;
    static documentation = "Represents a directive, like \"use strict\";";

    static propdoc = {
        value: "[string] The value of this directive as a plain string (it's not an AST_String!)",
        quote: "[string] the original quote character"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.value = props.value;
            this.quote = props.quote;
        }
    }
}

class AST_SimpleStatement extends AST_Statement {
    static TYPE = "SimpleStatement";
    TYPE = "SimpleStatement";
    CTOR = AST_SimpleStatement;
    static documentation = "A statement consisting of an expression, i.e. a = 1 + 2";

    static propdoc = {
        body: "[AST_Node] an expression node (should not be instanceof AST_Statement)"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.body = props.body;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.body._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.body);
    }
}

function walk_body(node, visitor) {
    const body = node.body;
    for (var i = 0, len = body.length; i < len; i++) {
        body[i]._walk(visitor);
    }
}

function clone_block_scope(deep) {
    var clone = this._clone(deep);
    if (this.block_scope) {
        clone.block_scope = this.block_scope.clone();
    }
    return clone;
}

class AST_Block extends AST_Statement {
    static TYPE = "Block";
    TYPE = "Block";
    CTOR = AST_Block;
    static documentation = "A body of statements (usually braced)";

    static propdoc = {
        body: "[AST_Statement*] an array of statements",
        block_scope: "[AST_Scope] the block scope"
    };

    clone = clone_block_scope;

    constructor(props) {
        super(props);

        if (props) {
            this.body = props.body;
            this.block_scope = props.block_scope;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            walk_body(this, visitor);
        });
    }

    _children_backwards(push) {
        let i = this.body.length;
        while (i--) push(this.body[i]);
    }
}

class AST_BlockStatement extends AST_Block {
    static TYPE = "BlockStatement";
    TYPE = "BlockStatement";
    CTOR = AST_BlockStatement;
    static documentation = "A block statement";

    constructor(props) {
        super(props);
    }
}

class AST_EmptyStatement extends AST_Statement {
    static TYPE = "EmptyStatement";
    TYPE = "EmptyStatement";
    CTOR = AST_EmptyStatement;
    static documentation = "The empty statement (empty block or simply a semicolon)";

    constructor(props) {
        super(props);
    }
}

class AST_StatementWithBody extends AST_Statement {
    static TYPE = "StatementWithBody";
    TYPE = "StatementWithBody";
    CTOR = AST_StatementWithBody;
    static documentation = "Base class for all statements that contain one nested body: `For`, `ForIn`, `Do`, `While`, `With`";

    static propdoc = {
        body: "[AST_Statement] the body; this should always be present, even if it's an AST_EmptyStatement"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.body = props.body;
        }
    }
}

class AST_LabeledStatement extends AST_StatementWithBody {
    static TYPE = "LabeledStatement";
    TYPE = "LabeledStatement";
    CTOR = AST_LabeledStatement;
    static documentation = "Statement with a label";

    static propdoc = {
        label: "[AST_Label] a label definition"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.label = props.label;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.label._walk(visitor);
            this.body._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.body);
        push(this.label);
    }

    clone(deep) {
        var node = this._clone(deep);
        if (deep) {
            var label = node.label;
            var def = this.label;
            node.walk(new TreeWalker(function(node) {
                if (node instanceof AST_LoopControl
                    && node.label && node.label.thedef === def) {
                    node.label.thedef = label;
                    label.references.push(node);
                }
            }));
        }
        return node;
    }
}

class AST_IterationStatement extends AST_StatementWithBody {
    static TYPE = "IterationStatement";
    TYPE = "IterationStatement";
    CTOR = AST_IterationStatement;
    static documentation = "Internal class.  All loops inherit from it.";

    static propdoc = {
        block_scope: "[AST_Scope] the block scope for this iteration statement."
    };

    clone = clone_block_scope;

    constructor(props) {
        super(props);

        if (props) {
            this.block_scope = props.block_scope;
        }
    }
}

class AST_DWLoop extends AST_IterationStatement {
    static TYPE = "DWLoop";
    TYPE = "DWLoop";
    CTOR = AST_DWLoop;
    static documentation = "Base class for do/while statements";

    static propdoc = {
        condition: "[AST_Node] the loop condition.  Should not be instanceof AST_Statement"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.condition = props.condition;
        }
    }
}

class AST_Do extends AST_DWLoop {
    static TYPE = "Do";
    TYPE = "Do";
    CTOR = AST_Do;
    static documentation = "A `do` statement";

    constructor(props) {
        super(props);
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.body._walk(visitor);
            this.condition._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.condition);
        push(this.body);
    }
}

class AST_While extends AST_DWLoop {
    static TYPE = "While";
    TYPE = "While";
    CTOR = AST_While;
    static documentation = "A `while` statement";

    constructor(props) {
        super(props);
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.condition._walk(visitor);
            this.body._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.body);
        push(this.condition);
    }
}

class AST_For extends AST_IterationStatement {
    static TYPE = "For";
    TYPE = "For";
    CTOR = AST_For;
    static documentation = "A `for` statement";

    static propdoc = {
        init: "[AST_Node?] the `for` initialization code, or null if empty",
        condition: "[AST_Node?] the `for` termination clause, or null if empty",
        step: "[AST_Node?] the `for` update clause, or null if empty"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.init = props.init;
            this.condition = props.condition;
            this.step = props.step;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            if (this.init) this.init._walk(visitor);
            if (this.condition) this.condition._walk(visitor);
            if (this.step) this.step._walk(visitor);
            this.body._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.body);
        if (this.step) push(this.step);
        if (this.condition) push(this.condition);
        if (this.init) push(this.init);
    }
}

class AST_ForIn extends AST_IterationStatement {
    static TYPE = "ForIn";
    TYPE = "ForIn";
    CTOR = AST_ForIn;
    static documentation = "A `for ... in` statement";

    static propdoc = {
        init: "[AST_Node] the `for/in` initialization code",
        object: "[AST_Node] the object that we're looping through"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.init = props.init;
            this.object = props.object;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.init._walk(visitor);
            this.object._walk(visitor);
            this.body._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.body);
        if (this.object) push(this.object);
        if (this.init) push(this.init);
    }
}

class AST_ForOf extends AST_ForIn {
    static TYPE = "ForOf";
    TYPE = "ForOf";
    CTOR = AST_ForOf;
    static documentation = "A `for ... of` statement";

    constructor(props) {
        super(props);

        if (props) {
            this.await = props.await;
        }
    }
}

class AST_With extends AST_StatementWithBody {
    static TYPE = "With";
    TYPE = "With";
    CTOR = AST_With;
    static documentation = "A `with` statement";

    static propdoc = {
        expression: "[AST_Node] the `with` expression"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.expression = props.expression;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.expression._walk(visitor);
            this.body._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.body);
        push(this.expression);
    }
}

class AST_Scope extends AST_Block {
    static TYPE = "Scope";
    TYPE = "Scope";
    CTOR = AST_Scope;
    static documentation = "Base class for all statements introducing a lexical scope";

    static propdoc = {
        variables: "[Map/S] a map of name -> SymbolDef for all variables/functions defined in this scope",
        uses_with: "[boolean/S] tells whether this scope uses the `with` statement",
        uses_eval: "[boolean/S] tells whether this scope contains a direct call to the global `eval`",
        parent_scope: "[AST_Scope?/S] link to the parent scope",
        enclosed: "[SymbolDef*/S] a list of all symbol definitions that are accessed from this scope or any subscopes",
        cname: "[integer/S] current index for mangling variables (used internally by the mangler)",
    };

    constructor(props) {
        super(props);

        if (props) {
            this.variables = props.variables;
            this.functions = props.functions;
            this.uses_with = props.uses_with;
            this.uses_eval = props.uses_eval;
            this.parent_scope = props.parent_scope;
            this.enclosed = props.enclosed;
            this.cname = props.cname;
        }
    }

    get_defun_scope() {
        var self = this;
        while (self.is_block_scope()) {
            self = self.parent_scope;
        }
        return self;
    }

    clone(deep, toplevel) {
        var node = this._clone(deep);
        if (deep && this.variables && toplevel && !this._block_scope) {
            node.figure_out_scope({}, {
                toplevel: toplevel,
                parent_scope: this.parent_scope
            });
        } else {
            if (this.variables) node.variables = new Map(this.variables);
            if (this.enclosed) node.enclosed = this.enclosed.slice();
            if (this._block_scope) node._block_scope = this._block_scope;
        }
        return node;
    }

    pinned() {
        return this.uses_eval || this.uses_with;
    }
}

class AST_Toplevel extends AST_Scope {
    static TYPE = "Toplevel";
    TYPE = "Toplevel";
    CTOR = AST_Toplevel;
    static documentation = "The toplevel scope";

    static propdoc = {
        globals: "[Map/S] a map of name -> SymbolDef for all undeclared names",
    };

    constructor(props) {
        super(props);

        if (props) {
            this.globals = props.globals;
        }
    }

    wrap_commonjs(name) {
        var body = this.body;
        var wrapped_tl = "(function(exports){'$ORIG';})(typeof " + name + "=='undefined'?(" + name + "={}):" + name + ");";
        wrapped_tl = parse(wrapped_tl);
        wrapped_tl = wrapped_tl.transform(new TreeTransformer(function(node) {
            if (node instanceof AST_Directive && node.value == "$ORIG") {
                return MAP.splice(body);
            }
        }));
        return wrapped_tl;
    }

    wrap_enclose(args_values) {
        if (typeof args_values != "string") args_values = "";
        var index = args_values.indexOf(":");
        if (index < 0) index = args_values.length;
        var body = this.body;
        return parse([
            "(function(",
            args_values.slice(0, index),
            '){"$ORIG"})(',
            args_values.slice(index + 1),
            ")"
        ].join("")).transform(new TreeTransformer(function(node) {
            if (node instanceof AST_Directive && node.value == "$ORIG") {
                return MAP.splice(body);
            }
        }));
    }
}

class AST_Expansion extends AST_Node {
    static TYPE = "Expansion";
    TYPE = "Expansion";
    CTOR = AST_Expansion;
    static documentation = "An expandible argument, such as ...rest, a splat, such as [1,2,...all], or an expansion in a variable declaration, such as var [first, ...rest] = list";

    static propdoc = {
        expression: "[AST_Node] the thing to be expanded"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.expression = props.expression;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.expression.walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.expression);
    }
}

class AST_Lambda extends AST_Scope {
    static TYPE = "Lambda";
    TYPE = "Lambda";
    CTOR = AST_Lambda;
    static documentation = "Base class for functions";

    static propdoc = {
        name: "[AST_SymbolDeclaration?] the name of this function",
        argnames: "[AST_SymbolFunarg|AST_Destructuring|AST_Expansion|AST_DefaultAssign*] array of function arguments, destructurings, or expanding arguments",
        uses_arguments: "[boolean/S] tells whether this function accesses the arguments array",
        is_generator: "[boolean] is this a generator method",
        async: "[boolean] is this method async",
    };

    constructor(props) {
        super(props);

        if (props) {
            this.name = props.name;
            this.argnames = props.argnames;
            this.uses_arguments = props.uses_arguments;
            this.is_generator = props.is_generator;
            this.async = props.async;
        }
    }

    args_as_names() {
        var out = [];
        for (var i = 0; i < this.argnames.length; i++) {
            if (this.argnames[i] instanceof AST_Destructuring) {
                out.push(...this.argnames[i].all_symbols());
            } else {
                out.push(this.argnames[i]);
            }
        }
        return out;
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            if (this.name) this.name._walk(visitor);
            var argnames = this.argnames;
            for (var i = 0, len = argnames.length; i < len; i++) {
                argnames[i]._walk(visitor);
            }
            walk_body(this, visitor);
        });
    }

    _children_backwards(push) {
        let i = this.body.length;
        while (i--) push(this.body[i]);

        i = this.argnames.length;
        while (i--) push(this.argnames[i]);

        if (this.name) push(this.name);
    }

    is_braceless() {
        return this.body[0] instanceof AST_Return && this.body[0].value;
    }

    length_property() {
        let length = 0;

        for (const arg of this.argnames) {
            if (arg instanceof AST_SymbolFunarg || arg instanceof AST_Destructuring) {
                length++;
            }
        }

        return length;
    }
}

class AST_Accessor extends AST_Lambda {
    static TYPE = "Accessor";
    TYPE = "Accessor";
    CTOR = AST_Accessor;
    static documentation = "A setter/getter function.  The `name` property is always null.";

    constructor(props) {
        super(props);
    }
}

class AST_Function extends AST_Lambda {
    static TYPE = "Function";
    TYPE = "Function";
    CTOR = AST_Function;
    static documentation = "A function expression";

    constructor(props) {
        super(props);
    }
}

class AST_Arrow extends AST_Lambda {
    static TYPE = "Arrow";
    TYPE = "Arrow";
    CTOR = AST_Arrow;
    static documentation = "An ES6 Arrow function ((a) => b)";

    constructor(props) {
        super(props);
    }
}

class AST_Defun extends AST_Lambda {
    static TYPE = "Defun";
    TYPE = "Defun";
    CTOR = AST_Defun;
    static documentation = "A function definition";

    constructor(props) {
        super(props);
    }
}

class AST_Destructuring extends AST_Node {
    static TYPE = "Destructuring";
    TYPE = "Destructuring";
    CTOR = AST_Destructuring;
    static documentation = "A destructuring of several names. Used in destructuring assignment and with destructuring function argument names";

    static propdoc = {
        "names": "[AST_Node*] Array of properties or elements",
        "is_array": "[Boolean] Whether the destructuring represents an object or array"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.names = props.names;
            this.is_array = props.is_array;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.names.forEach(function(name) {
                name._walk(visitor);
            });
        });
    }

    _children_backwards(push) {
        let i = this.names.length;
        while (i--) push(this.names[i]);
    }

    all_symbols() {
        var out = [];
        this.walk(new TreeWalker(function (node) {
            if (node instanceof AST_Symbol) {
                out.push(node);
            }
        }));
        return out;
    }
}

class AST_PrefixedTemplateString extends AST_Node {
    static TYPE = "PrefixedTemplateString";
    TYPE = "PrefixedTemplateString";
    CTOR = AST_PrefixedTemplateString;
    static documentation = "A templatestring with a prefix, such as String.raw`foobarbaz`";

    static propdoc = {
        template_string: "[AST_TemplateString] The template string",
        prefix: "[AST_Node] The prefix, which will get called."
    };

    constructor(props) {
        super(props);

        if (props) {
            this.template_string = props.template_string;
            this.prefix = props.prefix;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function () {
            this.prefix._walk(visitor);
            this.template_string._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.template_string);
        push(this.prefix);
    }
}

class AST_TemplateString extends AST_Node {
    static TYPE = "TemplateString";
    TYPE = "TemplateString";
    CTOR = AST_TemplateString;
    static documentation = "A template string literal";

    static propdoc = {
        segments: "[AST_Node*] One or more segments, starting with AST_TemplateSegment. AST_Node may follow AST_TemplateSegment, but each AST_Node must be followed by AST_TemplateSegment."
    };

    constructor(props) {
        super(props);

        if (props) {
            this.segments = props.segments;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.segments.forEach(function(seg) {
                seg._walk(visitor);
            });
        });
    }

    _children_backwards(push) {
        let i = this.segments.length;
        while (i--) push(this.segments[i]);
    }
}

class AST_TemplateSegment extends AST_Node {
    static TYPE = "TemplateSegment";
    TYPE = "TemplateSegment";
    CTOR = AST_TemplateSegment;
    static documentation = "A segment of a template string literal";

    static propdoc = {
        value: "Content of the segment",
        raw: "Raw source of the segment",
    };

    constructor(props) {
        super(props);

        if (props) {
            this.value = props.value;
            this.raw = props.raw;
        }
    }
}

class AST_Jump extends AST_Statement {
    static TYPE = "Jump";
    TYPE = "Jump";
    CTOR = AST_Jump;
    static documentation = "Base class for “jumps” (for now that's `return`, `throw`, `break` and `continue`)";

    constructor(props) {
        super(props);
    }
}

class AST_Exit extends AST_Jump {
    static TYPE = "Exit";
    TYPE = "Exit";
    CTOR = AST_Exit;
    static documentation = "Base class for “exits” (`return` and `throw`)";

    static propdoc = {
        value: "[AST_Node?] the value returned or thrown by this statement; could be null for AST_Return"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.value = props.value;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, this.value && function() {
            this.value._walk(visitor);
        });
    }

    _children_backwards(push) {
        if (this.value) push(this.value);
    }
}

class AST_Return extends AST_Exit {
    static TYPE = "Return";
    TYPE = "Return";
    CTOR = AST_Return;
    static documentation = "A `return` statement";

    constructor(props) {
        super(props);
    }
}

class AST_Throw extends AST_Exit {
    static TYPE = "Throw";
    TYPE = "Throw";
    CTOR = AST_Throw;
    static documentation = "A `throw` statement";

    constructor(props) {
        super(props);
    }
}

class AST_LoopControl extends AST_Jump {
    static TYPE = "LoopControl";
    TYPE = "LoopControl";
    CTOR = AST_LoopControl;
    static documentation = "Base class for loop control statements (`break` and `continue`)";

    static propdoc = {
        label: "[AST_LabelRef?] the label, or null if none",
    };

    constructor(props) {
        super(props);

        if (props) {
            this.label = props.label;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, this.label && function() {
            this.label._walk(visitor);
        });
    }

    _children_backwards(push) {
        if (this.label) push(this.label);
    }
}

class AST_Break extends AST_LoopControl {
    static TYPE = "Break";
    TYPE = "Break";
    CTOR = AST_Break;
    static documentation = "A `break` statement";

    constructor(props) {
        super(props);
    }
}

class AST_Continue extends AST_LoopControl {
    static TYPE = "Continue";
    TYPE = "Continue";
    CTOR = AST_Continue;
    static documentation = "A `continue` statement";

    constructor(props) {
        super(props);
    }
}

class AST_Await extends AST_Node {
    static TYPE = "Await";
    TYPE = "Await";
    CTOR = AST_Await;
    static documentation = "An `await` statement";

    static propdoc = {
        expression: "[AST_Node] the mandatory expression being awaited",
    };

    constructor(props) {
        super(props);

        if (props) {
            this.expression = props.expression;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.expression._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.expression);
    }
}

class AST_Yield extends AST_Node {
    static TYPE = "Yield";
    TYPE = "Yield";
    CTOR = AST_Yield;
    static documentation = "A `yield` statement";

    static propdoc = {
        expression: "[AST_Node?] the value returned or thrown by this statement; could be null (representing undefined) but only when is_star is set to false",
        is_star: "[Boolean] Whether this is a yield or yield* statement"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.expression = props.expression;
            this.is_star = props.is_star;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, this.expression && function() {
            this.expression._walk(visitor);
        });
    }

    _children_backwards(push) {
        if (this.expression) push(this.expression);
    }
}

class AST_If extends AST_StatementWithBody {
    static TYPE = "If";
    TYPE = "If";
    CTOR = AST_If;
    static documentation = "A `if` statement";

    static propdoc = {
        condition: "[AST_Node] the `if` condition",
        alternative: "[AST_Statement?] the `else` part, or null if not present"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.condition = props.condition;
            this.alternative = props.alternative;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.condition._walk(visitor);
            this.body._walk(visitor);
            if (this.alternative) this.alternative._walk(visitor);
        });
    }

    _children_backwards(push) {
        if (this.alternative) {
            push(this.alternative);
        }
        push(this.body);
        push(this.condition);
    }
}

class AST_Switch extends AST_Block {
    static TYPE = "Switch";
    TYPE = "Switch";
    CTOR = AST_Switch;
    static documentation = "A `switch` statement";

    static propdoc = {
        expression: "[AST_Node] the `switch` “discriminant”"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.expression = props.expression;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.expression._walk(visitor);
            walk_body(this, visitor);
        });
    }

    _children_backwards(push) {
        let i = this.body.length;
        while (i--) push(this.body[i]);
        push(this.expression);
    }
}

class AST_SwitchBranch extends AST_Block {
    static TYPE = "SwitchBranch";
    TYPE = "SwitchBranch";
    CTOR = AST_SwitchBranch;
    static documentation = "Base class for `switch` branches";

    constructor(props) {
        super(props);
    }
}

class AST_Default extends AST_SwitchBranch {
    static TYPE = "Default";
    TYPE = "Default";
    CTOR = AST_Default;
    static documentation = "A `default` switch branch";

    constructor(props) {
        super(props);
    }
}

class AST_Case extends AST_SwitchBranch {
    static TYPE = "Case";
    TYPE = "Case";
    CTOR = AST_Case;
    static documentation = "A `case` switch branch";

    static propdoc = {
        expression: "[AST_Node] the `case` expression"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.expression = props.expression;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.expression._walk(visitor);
            walk_body(this, visitor);
        });
    }

    _children_backwards(push) {
        let i = this.body.length;
        while (i--) push(this.body[i]);
        push(this.expression);
    }
}

class AST_Try extends AST_Block {
    static TYPE = "Try";
    TYPE = "Try";
    CTOR = AST_Try;
    static documentation = "A `try` statement";

    static propdoc = {
        bcatch: "[AST_Catch?] the catch block, or null if not present",
        bfinally: "[AST_Finally?] the finally block, or null if not present"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.bcatch = props.bcatch;
            this.bfinally = props.bfinally;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            walk_body(this, visitor);
            if (this.bcatch) this.bcatch._walk(visitor);
            if (this.bfinally) this.bfinally._walk(visitor);
        });
    }

    _children_backwards(push) {
        if (this.bfinally) push(this.bfinally);
        if (this.bcatch) push(this.bcatch);
        let i = this.body.length;
        while (i--) push(this.body[i]);
    }
}

class AST_Catch extends AST_Block {
    static TYPE = "Catch";
    TYPE = "Catch";
    CTOR = AST_Catch;
    static documentation = "A `catch` node; only makes sense as part of a `try` statement";

    static propdoc = {
        argname: "[AST_SymbolCatch|AST_Destructuring|AST_Expansion|AST_DefaultAssign] symbol for the exception"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.argname = props.argname;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            if (this.argname) this.argname._walk(visitor);
            walk_body(this, visitor);
        });
    }

    _children_backwards(push) {
        let i = this.body.length;
        while (i--) push(this.body[i]);
        if (this.argname) push(this.argname);
    }
}

class AST_Finally extends AST_Block {
    static TYPE = "Finally";
    TYPE = "Finally";
    CTOR = AST_Finally;
    static documentation = "A `finally` node; only makes sense as part of a `try` statement";

    constructor(props) {
        super(props);
    }
}

class AST_Definitions extends AST_Statement {
    static TYPE = "Definitions";
    TYPE = "Definitions";
    CTOR = AST_Definitions;
    static documentation = "Base class for `var` or `const` nodes (variable declarations/initializations)";

    static propdoc = {
        definitions: "[AST_VarDef*] array of variable definitions"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.definitions = props.definitions;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            var definitions = this.definitions;
            for (var i = 0, len = definitions.length; i < len; i++) {
                definitions[i]._walk(visitor);
            }
        });
    }

    _children_backwards(push) {
        let i = this.definitions.length;
        while (i--) push(this.definitions[i]);
    }
}

class AST_Var extends AST_Definitions {
    static TYPE = "Var";
    TYPE = "Var";
    CTOR = AST_Var;
    static documentation = "A `var` statement";

    constructor(props) {
        super(props);
    }
}

class AST_Let extends AST_Definitions {
    static TYPE = "Let";
    TYPE = "Let";
    CTOR = AST_Let;
    static documentation = "A `let` statement";

    constructor(props) {
        super(props);
    }
}

class AST_Const extends AST_Definitions {
    static TYPE = "Const";
    TYPE = "Const";
    CTOR = AST_Const;
    static documentation = "A `const` statement";

    constructor(props) {
        super(props);
    }
}

class AST_VarDef extends AST_Node {
    static TYPE = "VarDef";
    TYPE = "VarDef";
    CTOR = AST_VarDef;
    static documentation = "A variable declaration; only appears in a AST_Definitions node";

    static propdoc = {
        name: "[AST_Destructuring|AST_SymbolConst|AST_SymbolLet|AST_SymbolVar] name of the variable",
        value: "[AST_Node?] initializer, or null of there's no initializer"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.name = props.name;
            this.value = props.value;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.name._walk(visitor);
            if (this.value) this.value._walk(visitor);
        });
    }

    _children_backwards(push) {
        if (this.value) push(this.value);
        push(this.name);
    }
}

class AST_NameMapping extends AST_Node {
    static TYPE = "NameMapping";
    TYPE = "NameMapping";
    CTOR = AST_NameMapping;
    static documentation = "The part of the export/import statement that declare names from a module.";

    static propdoc = {
        foreign_name: "[AST_SymbolExportForeign|AST_SymbolImportForeign] The name being exported/imported (as specified in the module)",
        name: "[AST_SymbolExport|AST_SymbolImport] The name as it is visible to this module."
    };

    constructor(props) {
        super(props);

        if (props) {
            this.foreign_name = props.foreign_name;
            this.name = props.name;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.foreign_name._walk(visitor);
            this.name._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.name);
        push(this.foreign_name);
    }
}

class AST_Import extends AST_Node {
    static TYPE = "Import";
    TYPE = "Import";
    CTOR = AST_Import;
    static documentation = "An `import` statement";

    static propdoc = {
        imported_name: "[AST_SymbolImport] The name of the variable holding the module's default export.",
        imported_names: "[AST_NameMapping*] The names of non-default imported variables",
        module_name: "[AST_String] String literal describing where this module came from",
        assert_clause: "[AST_Object?] The import assertion"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.imported_name = props.imported_name;
            this.imported_names = props.imported_names;
            this.module_name = props.module_name;
            this.assert_clause = props.assert_clause;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            if (this.imported_name) {
                this.imported_name._walk(visitor);
            }
            if (this.imported_names) {
                this.imported_names.forEach(function(name_import) {
                    name_import._walk(visitor);
                });
            }
            this.module_name._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.module_name);
        if (this.imported_names) {
            let i = this.imported_names.length;
            while (i--) push(this.imported_names[i]);
        }
        if (this.imported_name) push(this.imported_name);
    }
}

class AST_ImportMeta extends AST_Node {
    static TYPE = "ImportMeta";
    TYPE = "ImportMeta";
    CTOR = AST_ImportMeta;
    static documentation = "A reference to import.meta";

    constructor(props) {
        super(props);
    }
}

class AST_Export extends AST_Statement {
    static TYPE = "Export";
    TYPE = "Export";
    CTOR = AST_Export;
    static documentation = "An `export` statement";

    static propdoc = {
        exported_definition: "[AST_Defun|AST_Definitions|AST_DefClass?] An exported definition",
        exported_value: "[AST_Node?] An exported value",
        exported_names: "[AST_NameMapping*?] List of exported names",
        module_name: "[AST_String?] Name of the file to load exports from",
        is_default: "[Boolean] Whether this is the default exported value of this module",
        assert_clause: "[AST_Object?] The import assertion"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.exported_definition = props.exported_definition;
            this.exported_value = props.exported_value;
            this.is_default = props.is_default;
            this.exported_names = props.exported_names;
            this.module_name = props.module_name;
            this.assert_clause = props.assert_clause;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function () {
            if (this.exported_definition) {
                this.exported_definition._walk(visitor);
            }
            if (this.exported_value) {
                this.exported_value._walk(visitor);
            }
            if (this.exported_names) {
                this.exported_names.forEach(function(name_export) {
                    name_export._walk(visitor);
                });
            }
            if (this.module_name) {
                this.module_name._walk(visitor);
            }
        });
    }

    _children_backwards(push) {
        if (this.module_name) push(this.module_name);
        if (this.exported_names) {
            let i = this.exported_names.length;
            while (i--) push(this.exported_names[i]);
        }
        if (this.exported_value) push(this.exported_value);
        if (this.exported_definition) push(this.exported_definition);
    }
}

class AST_Call extends AST_Node {
    static TYPE = "Call";
    TYPE = "Call";
    CTOR = AST_Call;
    static documentation = "A function call expression";

    static propdoc = {
        expression: "[AST_Node] expression to invoke as function",
        args: "[AST_Node*] array of arguments",
        optional: "[boolean] whether this is an optional call (IE ?.() )",
        _annotations: "[number] bitfield containing information about the call"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.expression = props.expression;
            this.args = props.args;
            this.optional = props.optional;
            this._annotations = props._annotations;
            this.initialize();
        }
    }

    initialize() {
        if (this._annotations == null) this._annotations = 0;
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            var args = this.args;
            for (var i = 0, len = args.length; i < len; i++) {
                args[i]._walk(visitor);
            }
            this.expression._walk(visitor);  // TODO why do we need to crawl this last?
        });
    }

    _children_backwards(push) {
        let i = this.args.length;
        while (i--) push(this.args[i]);
        push(this.expression);
    }
}

class AST_New extends AST_Call {
    static TYPE = "New";
    TYPE = "New";
    CTOR = AST_New;
    static documentation = "An object instantiation.  Derives from a function call since it has exactly the same properties";

    constructor(props) {
        super(props);

        if (props) {
            this.initialize();
        }
    }
}

class AST_Sequence extends AST_Node {
    static TYPE = "Sequence";
    TYPE = "Sequence";
    CTOR = AST_Sequence;
    static documentation = "A sequence expression (comma-separated expressions)";

    static propdoc = {
        expressions: "[AST_Node*] array of expressions (at least two)"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.expressions = props.expressions;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.expressions.forEach(function(node) {
                node._walk(visitor);
            });
        });
    }

    _children_backwards(push) {
        let i = this.expressions.length;
        while (i--) push(this.expressions[i]);
    }
}

class AST_PropAccess extends AST_Node {
    static TYPE = "PropAccess";
    TYPE = "PropAccess";
    CTOR = AST_PropAccess;
    static documentation = "Base class for property access expressions, i.e. `a.foo` or `a[\"foo\"]`";

    static propdoc = {
        expression: "[AST_Node] the “container” expression",
        property: "[AST_Node|string] the property to access.  For AST_Dot & AST_DotHash this is always a plain string, while for AST_Sub it's an arbitrary AST_Node",

        optional: "[boolean] whether this is an optional property access (IE ?.)"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.expression = props.expression;
            this.property = props.property;
            this.optional = props.optional;
        }
    }
}

class AST_Dot extends AST_PropAccess {
    static TYPE = "Dot";
    TYPE = "Dot";
    CTOR = AST_Dot;
    static documentation = "A dotted property access expression";

    static propdoc = {
        quote: "[string] the original quote character when transformed from AST_Sub",
    };

    constructor(props) {
        super(props);

        if (props) {
            this.quote = props.quote;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.expression._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.expression);
    }
}

class AST_DotHash extends AST_PropAccess {
    static TYPE = "DotHash";
    TYPE = "DotHash";
    CTOR = AST_DotHash;
    static documentation = "A dotted property access to a private property";

    constructor(props) {
        super(props);
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.expression._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.expression);
    }
}

class AST_Sub extends AST_PropAccess {
    static TYPE = "Sub";
    TYPE = "Sub";
    CTOR = AST_Sub;
    static documentation = "Index-style property access, i.e. `a[\"foo\"]`";

    constructor(props) {
        super(props);
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.expression._walk(visitor);
            this.property._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.property);
        push(this.expression);
    }
}

class AST_Chain extends AST_Node {
    static TYPE = "Chain";
    TYPE = "Chain";
    CTOR = AST_Chain;
    static documentation = "A chain expression like a?.b?.(c)?.[d]";

    static propdoc = {
        expression: "[AST_Call|AST_Dot|AST_DotHash|AST_Sub] chain element."
    };

    constructor(props) {
        super(props);

        if (props) {
            this.expression = props.expression;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.expression._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.expression);
    }
}

class AST_Unary extends AST_Node {
    static TYPE = "Unary";
    TYPE = "Unary";
    CTOR = AST_Unary;
    static documentation = "Base class for unary expressions";

    static propdoc = {
        operator: "[string] the operator",
        expression: "[AST_Node] expression that this unary operator applies to"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.operator = props.operator;
            this.expression = props.expression;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.expression._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.expression);
    }
}

class AST_UnaryPrefix extends AST_Unary {
    static TYPE = "UnaryPrefix";
    TYPE = "UnaryPrefix";
    CTOR = AST_UnaryPrefix;
    static documentation = "Unary prefix expression, i.e. `typeof i` or `++i`";

    constructor(props) {
        super(props);
    }
}

class AST_UnaryPostfix extends AST_Unary {
    static TYPE = "UnaryPostfix";
    TYPE = "UnaryPostfix";
    CTOR = AST_UnaryPostfix;
    static documentation = "Unary postfix expression, i.e. `i++`";

    constructor(props) {
        super(props);
    }
}

class AST_Binary extends AST_Node {
    static TYPE = "Binary";
    TYPE = "Binary";
    CTOR = AST_Binary;
    static documentation = "Binary expression, i.e. `a + b`";

    static propdoc = {
        left: "[AST_Node] left-hand side expression",
        operator: "[string] the operator",
        right: "[AST_Node] right-hand side expression"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.operator = props.operator;
            this.left = props.left;
            this.right = props.right;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.left._walk(visitor);
            this.right._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.right);
        push(this.left);
    }
}

class AST_Conditional extends AST_Node {
    static TYPE = "Conditional";
    TYPE = "Conditional";
    CTOR = AST_Conditional;
    static documentation = "Conditional expression using the ternary operator, i.e. `a ? b : c`";

    static propdoc = {
        condition: "[AST_Node]",
        consequent: "[AST_Node]",
        alternative: "[AST_Node]"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.condition = props.condition;
            this.consequent = props.consequent;
            this.alternative = props.alternative;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            this.condition._walk(visitor);
            this.consequent._walk(visitor);
            this.alternative._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.alternative);
        push(this.consequent);
        push(this.condition);
    }
}

class AST_Assign extends AST_Binary {
    static TYPE = "Assign";
    TYPE = "Assign";
    CTOR = AST_Assign;
    static documentation = "An assignment expression — `a = b + 5`";

    static propdoc = {
        logical: "Whether it's a logical assignment"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.logical = props.logical;
        }
    }
}

class AST_DefaultAssign extends AST_Binary {
    static TYPE = "DefaultAssign";
    TYPE = "DefaultAssign";
    CTOR = AST_DefaultAssign;
    static documentation = "A default assignment expression like in `(a = 3) => a`";

    constructor(props) {
        super(props);
    }
}

class AST_Array extends AST_Node {
    static TYPE = "Array";
    TYPE = "Array";
    CTOR = AST_Array;
    static documentation = "An array literal";

    static propdoc = {
        elements: "[AST_Node*] array of elements"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.elements = props.elements;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            var elements = this.elements;
            for (var i = 0, len = elements.length; i < len; i++) {
                elements[i]._walk(visitor);
            }
        });
    }

    _children_backwards(push) {
        let i = this.elements.length;
        while (i--) push(this.elements[i]);
    }
}

class AST_Object extends AST_Node {
    static TYPE = "Object";
    TYPE = "Object";
    CTOR = AST_Object;
    static documentation = "An object literal";

    static propdoc = {
        properties: "[AST_ObjectProperty*] array of properties"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.properties = props.properties;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            var properties = this.properties;
            for (var i = 0, len = properties.length; i < len; i++) {
                properties[i]._walk(visitor);
            }
        });
    }

    _children_backwards(push) {
        let i = this.properties.length;
        while (i--) push(this.properties[i]);
    }
}

class AST_ObjectProperty extends AST_Node {
    static TYPE = "ObjectProperty";
    TYPE = "ObjectProperty";
    CTOR = AST_ObjectProperty;
    static documentation = "Base class for literal object properties";

    static propdoc = {
        key: "[string|AST_Node] property name. For ObjectKeyVal this is a string. For getters, setters and computed property this is an AST_Node.",
        value: "[AST_Node] property value.  For getters and setters this is an AST_Accessor."
    };

    constructor(props) {
        super(props);

        if (props) {
            this.key = props.key;
            this.value = props.value;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            if (this.key instanceof AST_Node)
                this.key._walk(visitor);
            this.value._walk(visitor);
        });
    }

    _children_backwards(push) {
        push(this.value);
        if (this.key instanceof AST_Node) push(this.key);
    }
}

class AST_ObjectKeyVal extends AST_ObjectProperty {
    static TYPE = "ObjectKeyVal";
    TYPE = "ObjectKeyVal";
    CTOR = AST_ObjectKeyVal;
    static documentation = "A key: value object property";

    static propdoc = {
        quote: "[string] the original quote character"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.quote = props.quote;
        }
    }

    computed_key() {
        return this.key instanceof AST_Node;
    }
}

class AST_PrivateSetter extends AST_ObjectProperty {
    static TYPE = "PrivateSetter";
    TYPE = "PrivateSetter";
    CTOR = AST_PrivateSetter;

    static propdoc = {
        static: "[boolean] whether this is a static private setter"
    };

    static documentation = "A private setter property";

    constructor(props) {
        super(props);

        if (props) {
            this.static = props.static;
        }
    }

    computed_key() {
        return false;
    }
}

class AST_PrivateGetter extends AST_ObjectProperty {
    static TYPE = "PrivateGetter";
    TYPE = "PrivateGetter";
    CTOR = AST_PrivateGetter;

    static propdoc = {
        static: "[boolean] whether this is a static private getter"
    };

    static documentation = "A private getter property";

    constructor(props) {
        super(props);

        if (props) {
            this.static = props.static;
        }
    }

    computed_key() {
        return false;
    }
}

class AST_ObjectSetter extends AST_ObjectProperty {
    static TYPE = "ObjectSetter";
    TYPE = "ObjectSetter";
    CTOR = AST_ObjectSetter;

    static propdoc = {
        quote: "[string|undefined] the original quote character, if any",
        static: "[boolean] whether this is a static setter (classes only)"
    };

    static documentation = "An object setter property";

    constructor(props) {
        super(props);

        if (props) {
            this.quote = props.quote;
            this.static = props.static;
        }
    }

    computed_key() {
        return !(this.key instanceof AST_SymbolMethod);
    }
}

class AST_ObjectGetter extends AST_ObjectProperty {
    static TYPE = "ObjectGetter";
    TYPE = "ObjectGetter";
    CTOR = AST_ObjectGetter;

    static propdoc = {
        quote: "[string|undefined] the original quote character, if any",
        static: "[boolean] whether this is a static getter (classes only)"
    };

    static documentation = "An object getter property";

    constructor(props) {
        super(props);

        if (props) {
            this.quote = props.quote;
            this.static = props.static;
        }
    }

    computed_key() {
        return !(this.key instanceof AST_SymbolMethod);
    }
}

class AST_ConciseMethod extends AST_ObjectProperty {
    static TYPE = "ConciseMethod";
    TYPE = "ConciseMethod";
    CTOR = AST_ConciseMethod;

    static propdoc = {
        quote: "[string|undefined] the original quote character, if any",
        static: "[boolean] is this method static (classes only)",
        is_generator: "[boolean] is this a generator method",
        async: "[boolean] is this method async",
    };

    static documentation = "An ES6 concise method inside an object or class";

    constructor(props) {
        super(props);

        if (props) {
            this.quote = props.quote;
            this.static = props.static;
            this.is_generator = props.is_generator;
            this.async = props.async;
        }
    }

    computed_key() {
        return !(this.key instanceof AST_SymbolMethod);
    }
}

class AST_PrivateMethod extends AST_ConciseMethod {
    static TYPE = "PrivateMethod";
    TYPE = "PrivateMethod";
    CTOR = AST_PrivateMethod;
    static documentation = "A private class method inside a class";

    constructor(props) {
        super(props);
    }
}

class AST_Class extends AST_Scope {
    static TYPE = "Class";
    TYPE = "Class";
    CTOR = AST_Class;

    static propdoc = {
        name: "[AST_SymbolClass|AST_SymbolDefClass?] optional class name.",
        extends: "[AST_Node]? optional parent class",
        properties: "[AST_ObjectProperty*] array of properties"
    };

    static documentation = "An ES6 class";

    constructor(props) {
        super(props);

        if (props) {
            this.name = props.name;
            this.extends = props.extends;
            this.properties = props.properties;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            if (this.name) {
                this.name._walk(visitor);
            }
            if (this.extends) {
                this.extends._walk(visitor);
            }
            this.properties.forEach((prop) => prop._walk(visitor));
        });
    }

    _children_backwards(push) {
        let i = this.properties.length;
        while (i--) push(this.properties[i]);
        if (this.extends) push(this.extends);
        if (this.name) push(this.name);
    }
}

class AST_ClassProperty extends AST_ObjectProperty {
    static TYPE = "ClassProperty";
    TYPE = "ClassProperty";
    CTOR = AST_ClassProperty;
    static documentation = "A class property";

    static propdoc = {
        static: "[boolean] whether this is a static key",
        quote: "[string] which quote is being used"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.static = props.static;
            this.quote = props.quote;
        }
    }

    _walk(visitor) {
        return visitor._visit(this, function() {
            if (this.key instanceof AST_Node)
                this.key._walk(visitor);
            if (this.value instanceof AST_Node)
                this.value._walk(visitor);
        });
    }

    _children_backwards(push) {
        if (this.value instanceof AST_Node) push(this.value);
        if (this.key instanceof AST_Node) push(this.key);
    }

    computed_key() {
        return !(this.key instanceof AST_SymbolClassProperty);
    }
}

class AST_ClassPrivateProperty extends AST_ClassProperty {
    static TYPE = "ClassPrivateProperty";
    TYPE = "ClassPrivateProperty";
    CTOR = AST_ClassPrivateProperty;
    static documentation = "A class property for a private property";

    constructor(props) {
        super(props);
    }
}

class AST_DefClass extends AST_Class {
    static TYPE = "DefClass";
    TYPE = "DefClass";
    CTOR = AST_DefClass;
    static documentation = "A class definition";

    constructor(props) {
        super(props);
    }
}

class AST_ClassExpression extends AST_Class {
    static TYPE = "ClassExpression";
    TYPE = "ClassExpression";
    CTOR = AST_ClassExpression;
    static documentation = "A class expression.";

    constructor(props) {
        super(props);
    }
}

class AST_Symbol extends AST_Node {
    static TYPE = "Symbol";
    TYPE = "Symbol";
    CTOR = AST_Symbol;

    static propdoc = {
        name: "[string] name of this symbol",
        scope: "[AST_Scope/S] the current scope (not necessarily the definition scope)",
        thedef: "[SymbolDef/S] the definition of this symbol"
    };

    static documentation = "Base class for all symbols";

    constructor(props) {
        super(props);

        if (props) {
            this.scope = props.scope;
            this.name = props.name;
            this.thedef = props.thedef;
        }
    }
}

class AST_NewTarget extends AST_Node {
    static TYPE = "NewTarget";
    TYPE = "NewTarget";
    CTOR = AST_NewTarget;
    static documentation = "A reference to new.target";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolDeclaration extends AST_Symbol {
    static TYPE = "SymbolDeclaration";
    TYPE = "SymbolDeclaration";
    CTOR = AST_SymbolDeclaration;
    static documentation = "A declaration symbol (symbol in var/const, function name or argument, symbol in catch)";

    constructor(props) {
        super(props);

        if (props) {
            this.init = props.init;
        }
    }
}

class AST_SymbolVar extends AST_SymbolDeclaration {
    static TYPE = "SymbolVar";
    TYPE = "SymbolVar";
    CTOR = AST_SymbolVar;
    static documentation = "Symbol defining a variable";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolBlockDeclaration extends AST_SymbolDeclaration {
    static TYPE = "SymbolBlockDeclaration";
    TYPE = "SymbolBlockDeclaration";
    CTOR = AST_SymbolBlockDeclaration;
    static documentation = "Base class for block-scoped declaration symbols";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolConst extends AST_SymbolBlockDeclaration {
    static TYPE = "SymbolConst";
    TYPE = "SymbolConst";
    CTOR = AST_SymbolConst;
    static documentation = "A constant declaration";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolLet extends AST_SymbolBlockDeclaration {
    static TYPE = "SymbolLet";
    TYPE = "SymbolLet";
    CTOR = AST_SymbolLet;
    static documentation = "A block-scoped `let` declaration";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolFunarg extends AST_SymbolVar {
    static TYPE = "SymbolFunarg";
    TYPE = "SymbolFunarg";
    CTOR = AST_SymbolFunarg;
    static documentation = "Symbol naming a function argument";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolDefun extends AST_SymbolDeclaration {
    static TYPE = "SymbolDefun";
    TYPE = "SymbolDefun";
    CTOR = AST_SymbolDefun;
    static documentation = "Symbol defining a function";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolMethod extends AST_Symbol {
    static TYPE = "SymbolMethod";
    TYPE = "SymbolMethod";
    CTOR = AST_SymbolMethod;
    static documentation = "Symbol in an object defining a method";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolClassProperty extends AST_Symbol {
    static TYPE = "SymbolClassProperty";
    TYPE = "SymbolClassProperty";
    CTOR = AST_SymbolClassProperty;
    static documentation = "Symbol for a class property";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolLambda extends AST_SymbolDeclaration {
    static TYPE = "SymbolLambda";
    TYPE = "SymbolLambda";
    CTOR = AST_SymbolLambda;
    static documentation = "Symbol naming a function expression";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolDefClass extends AST_SymbolBlockDeclaration {
    static TYPE = "SymbolDefClass";
    TYPE = "SymbolDefClass";
    CTOR = AST_SymbolDefClass;
    static documentation = "Symbol naming a class's name in a class declaration. Lexically scoped to its containing scope, and accessible within the class.";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolClass extends AST_SymbolDeclaration {
    static TYPE = "SymbolClass";
    TYPE = "SymbolClass";
    CTOR = AST_SymbolClass;
    static documentation = "Symbol naming a class's name. Lexically scoped to the class.";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolCatch extends AST_SymbolBlockDeclaration {
    static TYPE = "SymbolCatch";
    TYPE = "SymbolCatch";
    CTOR = AST_SymbolCatch;
    static documentation = "Symbol naming the exception in catch";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolImport extends AST_SymbolBlockDeclaration {
    static TYPE = "SymbolImport";
    TYPE = "SymbolImport";
    CTOR = AST_SymbolImport;
    static documentation = "Symbol referring to an imported name";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolImportForeign extends AST_Symbol {
    static TYPE = "SymbolImportForeign";
    TYPE = "SymbolImportForeign";
    CTOR = AST_SymbolImportForeign;
    static documentation = "A symbol imported from a module, but it is defined in the other module, and its real name is irrelevant for this module's purposes";

    constructor(props) {
        super(props);
    }
}

class AST_Label extends AST_Symbol {
    static TYPE = "Label";
    TYPE = "Label";
    CTOR = AST_Label;
    static documentation = "Symbol naming a label (declaration)";

    static propdoc = {
        references: "[AST_LoopControl*] a list of nodes referring to this label"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.references = props.references;
            this.initialize();
        }
    }

    initialize() {
        this.references = [];
        this.thedef = this;
    }
}

class AST_SymbolRef extends AST_Symbol {
    static TYPE = "SymbolRef";
    TYPE = "SymbolRef";
    CTOR = AST_SymbolRef;
    static documentation = "Reference to some symbol (not definition/declaration)";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolExport extends AST_SymbolRef {
    static TYPE = "SymbolExport";
    TYPE = "SymbolExport";
    CTOR = AST_SymbolExport;
    static documentation = "Symbol referring to a name to export";

    constructor(props) {
        super(props);
    }
}

class AST_SymbolExportForeign extends AST_Symbol {
    static TYPE = "SymbolExportForeign";
    TYPE = "SymbolExportForeign";
    CTOR = AST_SymbolExportForeign;
    static documentation = "A symbol exported from this module, but it is used in the other module, and its real name is irrelevant for this module's purposes";

    constructor(props) {
        super(props);
    }
}

class AST_LabelRef extends AST_Symbol {
    static TYPE = "LabelRef";
    TYPE = "LabelRef";
    CTOR = AST_LabelRef;
    static documentation = "Reference to a label symbol";

    constructor(props) {
        super(props);
    }
}

class AST_This extends AST_Symbol {
    static TYPE = "This";
    TYPE = "This";
    CTOR = AST_This;
    static documentation = "The `this` symbol";

    constructor(props) {
        super(props);
    }
}

class AST_Super extends AST_This {
    static TYPE = "Super";
    TYPE = "Super";
    CTOR = AST_Super;
    static documentation = "The `super` symbol";

    constructor(props) {
        super(props);
    }
}

class AST_Constant extends AST_Node {
    static TYPE = "Constant";
    TYPE = "Constant";
    CTOR = AST_Constant;
    static documentation = "Base class for all constants";

    constructor(props) {
        super(props);
    }

    getValue() {
        return this.value;
    }
}

class AST_String extends AST_Constant {
    static TYPE = "String";
    TYPE = "String";
    CTOR = AST_String;
    static documentation = "A string literal";

    static propdoc = {
        value: "[string] the contents of this string",
        quote: "[string] the original quote character"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.value = props.value;
            this.quote = props.quote;
        }
    }
}

class AST_Number extends AST_Constant {
    static TYPE = "Number";
    TYPE = "Number";
    CTOR = AST_Number;
    static documentation = "A number literal";

    static propdoc = {
        value: "[number] the numeric value",
        raw: "[string] numeric value as string"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.value = props.value;
            this.raw = props.raw;
        }
    }
}

class AST_BigInt extends AST_Constant {
    static TYPE = "BigInt";
    TYPE = "BigInt";
    CTOR = AST_BigInt;
    static documentation = "A big int literal";

    static propdoc = {
        value: "[string] big int value"
    };

    constructor(props) {
        super(props);

        if (props) {
            this.value = props.value;
        }
    }
}

class AST_RegExp extends AST_Constant {
    static TYPE = "RegExp";
    TYPE = "RegExp";
    CTOR = AST_RegExp;
    static documentation = "A regexp literal";

    static propdoc = {
        value: "[RegExp] the actual regexp",
    };

    constructor(props) {
        super(props);

        if (props) {
            this.value = props.value;
        }
    }
}

class AST_Atom extends AST_Constant {
    static TYPE = "Atom";
    TYPE = "Atom";
    CTOR = AST_Atom;
    static documentation = "Base class for atoms";

    constructor(props) {
        super(props);
    }
}

class AST_Null extends AST_Atom {
    static TYPE = "Null";
    TYPE = "Null";
    CTOR = AST_Null;
    static documentation = "The `null` atom";
    value = null;

    constructor(props) {
        super(props);
    }
}

class AST_NaN extends AST_Atom {
    static TYPE = "NaN";
    TYPE = "NaN";
    CTOR = AST_NaN;
    static documentation = "The impossible value";
    value = 0/0;

    constructor(props) {
        super(props);
    }
}

class AST_Undefined extends AST_Atom {
    static TYPE = "Undefined";
    TYPE = "Undefined";
    CTOR = AST_Undefined;
    static documentation = "The `undefined` value";
    value = function() {}();

    constructor(props) {
        super(props);
    }
}

class AST_Hole extends AST_Atom {
    static TYPE = "Hole";
    TYPE = "Hole";
    CTOR = AST_Hole;
    static documentation = "A hole in an array";
    value = function() {}();

    constructor(props) {
        super(props);
    }
}

class AST_Infinity extends AST_Atom {
    static TYPE = "Infinity";
    TYPE = "Infinity";
    CTOR = AST_Infinity;
    static documentation = "The `Infinity` value";
    value = 1/0;

    constructor(props) {
        super(props);
    }
}

class AST_Boolean extends AST_Atom {
    static TYPE = "Boolean";
    TYPE = "Boolean";
    CTOR = AST_Boolean;
    static documentation = "Base class for booleans";

    constructor(props) {
        super(props);
    }
}

class AST_False extends AST_Boolean {
    static TYPE = "False";
    TYPE = "False";
    CTOR = AST_False;
    static documentation = "The `false` atom";
    value = false;

    constructor(props) {
        super(props);
    }
}

class AST_True extends AST_Boolean {
    static TYPE = "True";
    TYPE = "True";
    CTOR = AST_True;
    static documentation = "The `true` atom";
    value = true;

    constructor(props) {
        super(props);
    }
}

/* -----[ Walk function ]---- */

/**
 * Walk nodes in depth-first search fashion.
 * Callback can return `walk_abort` symbol to stop iteration.
 * It can also return `true` to stop iteration just for child nodes.
 * Iteration can be stopped and continued by passing the `to_visit` argument,
 * which is given to the callback in the second argument.
 **/
function walk(node, cb, to_visit = [node]) {
    const push = to_visit.push.bind(to_visit);
    while (to_visit.length) {
        const node = to_visit.pop();
        const ret = cb(node, to_visit);

        if (ret) {
            if (ret === walk_abort) return true;
            continue;
        }

        node._children_backwards(push);
    }
    return false;
}

function walk_parent(node, cb, initial_stack) {
    const to_visit = [node];
    const push = to_visit.push.bind(to_visit);
    const stack = initial_stack ? initial_stack.slice() : [];
    const parent_pop_indices = [];

    let current;

    const info = {
        parent: (n = 0) => {
            if (n === -1) {
                return current;
            }

            // [ p1 p0 ] [ 1 0 ]
            if (initial_stack && n >= stack.length) {
                n -= stack.length;
                return initial_stack[
                    initial_stack.length - (n + 1)
                ];
            }

            return stack[stack.length - (1 + n)];
        },
    };

    while (to_visit.length) {
        current = to_visit.pop();

        while (
            parent_pop_indices.length &&
            to_visit.length == parent_pop_indices[parent_pop_indices.length - 1]
        ) {
            stack.pop();
            parent_pop_indices.pop();
        }

        const ret = cb(current, info);

        if (ret) {
            if (ret === walk_abort) return true;
            continue;
        }

        const visit_length = to_visit.length;

        current._children_backwards(push);

        // Push only if we're going to traverse the children
        if (to_visit.length > visit_length) {
            stack.push(current);
            parent_pop_indices.push(visit_length - 1);
        }
    }

    return false;
}

const walk_abort = Symbol("abort walk");

/* -----[ TreeWalker ]----- */

class TreeWalker {
    constructor(callback) {
        this.visit = callback;
        this.stack = [];
        this.directives = Object.create(null);
    }

    _visit(node, descend) {
        this.push(node);
        var ret = this.visit(node, descend ? function() {
            descend.call(node);
        } : noop);
        if (!ret && descend) {
            descend.call(node);
        }
        this.pop();
        return ret;
    }

    parent(n) {
        return this.stack[this.stack.length - 2 - (n || 0)];
    }

    push(node) {
        if (node instanceof AST_Lambda) {
            this.directives = Object.create(this.directives);
        } else if (node instanceof AST_Directive && !this.directives[node.value]) {
            this.directives[node.value] = node;
        } else if (node instanceof AST_Class) {
            this.directives = Object.create(this.directives);
            if (!this.directives["use strict"]) {
                this.directives["use strict"] = node;
            }
        }
        this.stack.push(node);
    }

    pop() {
        var node = this.stack.pop();
        if (node instanceof AST_Lambda || node instanceof AST_Class) {
            this.directives = Object.getPrototypeOf(this.directives);
        }
    }

    self() {
        return this.stack[this.stack.length - 1];
    }

    find_parent(type) {
        var stack = this.stack;
        for (var i = stack.length; --i >= 0;) {
            var x = stack[i];
            if (x instanceof type) return x;
        }
    }

    has_directive(type) {
        var dir = this.directives[type];
        if (dir) return dir;
        var node = this.stack[this.stack.length - 1];
        if (node instanceof AST_Scope && node.body) {
            for (var i = 0; i < node.body.length; ++i) {
                var st = node.body[i];
                if (!(st instanceof AST_Directive)) break;
                if (st.value == type) return st;
            }
        }
    }

    loopcontrol_target(node) {
        var stack = this.stack;
        if (node.label) for (var i = stack.length; --i >= 0;) {
            var x = stack[i];
            if (x instanceof AST_LabeledStatement && x.label.name == node.label.name)
                return x.body;
        } else for (var i = stack.length; --i >= 0;) {
            var x = stack[i];
            if (x instanceof AST_IterationStatement
                || node instanceof AST_Break && x instanceof AST_Switch)
                return x;
        }
    }
}

// Tree transformer helpers.
class TreeTransformer extends TreeWalker {
    constructor(before, after) {
        super();
        this.before = before;
        this.after = after;
    }
}

const _PURE     = 0b00000001;
const _INLINE   = 0b00000010;
const _NOINLINE = 0b00000100;

export {
    AST_Accessor,
    AST_Array,
    AST_Arrow,
    AST_Assign,
    AST_Atom,
    AST_Await,
    AST_BigInt,
    AST_Binary,
    AST_Block,
    AST_BlockStatement,
    AST_Boolean,
    AST_Break,
    AST_Call,
    AST_Case,
    AST_Catch,
    AST_Chain,
    AST_Class,
    AST_ClassExpression,
    AST_ClassPrivateProperty,
    AST_ClassProperty,
    AST_ConciseMethod,
    AST_Conditional,
    AST_Const,
    AST_Constant,
    AST_Continue,
    AST_Debugger,
    AST_Default,
    AST_DefaultAssign,
    AST_DefClass,
    AST_Definitions,
    AST_Defun,
    AST_Destructuring,
    AST_Directive,
    AST_Do,
    AST_Dot,
    AST_DotHash,
    AST_DWLoop,
    AST_EmptyStatement,
    AST_Exit,
    AST_Expansion,
    AST_Export,
    AST_False,
    AST_Finally,
    AST_For,
    AST_ForIn,
    AST_ForOf,
    AST_Function,
    AST_Hole,
    AST_If,
    AST_Import,
    AST_ImportMeta,
    AST_Infinity,
    AST_IterationStatement,
    AST_Jump,
    AST_Label,
    AST_LabeledStatement,
    AST_LabelRef,
    AST_Lambda,
    AST_Let,
    AST_LoopControl,
    AST_NameMapping,
    AST_NaN,
    AST_New,
    AST_NewTarget,
    AST_Node,
    AST_Null,
    AST_Number,
    AST_Object,
    AST_ObjectGetter,
    AST_ObjectKeyVal,
    AST_ObjectProperty,
    AST_ObjectSetter,
    AST_PrefixedTemplateString,
    AST_PrivateGetter,
    AST_PrivateMethod,
    AST_PrivateSetter,
    AST_PropAccess,
    AST_RegExp,
    AST_Return,
    AST_Scope,
    AST_Sequence,
    AST_SimpleStatement,
    AST_Statement,
    AST_StatementWithBody,
    AST_String,
    AST_Sub,
    AST_Super,
    AST_Switch,
    AST_SwitchBranch,
    AST_Symbol,
    AST_SymbolBlockDeclaration,
    AST_SymbolCatch,
    AST_SymbolClass,
    AST_SymbolClassProperty,
    AST_SymbolConst,
    AST_SymbolDeclaration,
    AST_SymbolDefClass,
    AST_SymbolDefun,
    AST_SymbolExport,
    AST_SymbolExportForeign,
    AST_SymbolFunarg,
    AST_SymbolImport,
    AST_SymbolImportForeign,
    AST_SymbolLambda,
    AST_SymbolLet,
    AST_SymbolMethod,
    AST_SymbolRef,
    AST_SymbolVar,
    AST_TemplateSegment,
    AST_TemplateString,
    AST_This,
    AST_Throw,
    AST_Token,
    AST_Toplevel,
    AST_True,
    AST_Try,
    AST_Unary,
    AST_UnaryPostfix,
    AST_UnaryPrefix,
    AST_Undefined,
    AST_Var,
    AST_VarDef,
    AST_While,
    AST_With,
    AST_Yield,

    // Walkers
    TreeTransformer,
    TreeWalker,
    walk,
    walk_abort,
    walk_body,
    walk_parent,

    // annotations
    _INLINE,
    _NOINLINE,
    _PURE,
};
