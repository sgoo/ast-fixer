
# Description
At the moment this does the minimum set of changes to remove `eval` calls from the code.
It could probably do more, and in extreme cases it could go all the way to converting all the `DEFNODE` to `class` definitions.
Not sure what the consequences of a change that big would be...

# Running

Copy ast.orig.js to ast.js and then run the transform with npm.

```
cp ast.orig.js ast.js && npm start --  -t ./ast-fixer.js ./ast.js
```
