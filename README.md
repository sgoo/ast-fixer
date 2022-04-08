
# Description
At the moment this does the minimum set of changes to remove `eval` calls from the code.
It could probably do more, and in extreme cases it could go all the way to converting all the `DEFNODE` to `class` definitions.
Not sure what the consequences of a change that big would be...

# Running

## Fix terser

If terser is cloned into `../terser` you can run this set of commands:

```
npm start -- -t ./ast-fixer.js ../terser/lib/ast.js
npm start -- -t ./mozilla-ast-fixer.js ../terser/lib/mozilla-ast.js
npm start -- -t ./equivalent-to-fixer.js ../terser/lib/equivalent-to.js
```

After that has run it all he eval statements will be removed from runtime, but the output needs some changes.

* In `ast.js` the `DEFNODE` method needs to be tweaked a bit, to fit the new way its called.
* In `mozilla-ast.js` the `map` method can be removed.
* In `equivalent-ti.js` the `mkshallow` method can be removed.
