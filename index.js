const j = require('jscodeshift');

module.exports = function(fileInfo, api) {
    // Place holder value for `AST_Node`.
    const propMap = {'NoBase': []};
    // Hard code a list of the nodes that have an `initialize` method.
    const needsInitialize = new Set(['Call', 'New', 'Label']);

    return api.jscodeshift(fileInfo.source)
      .find(j.CallExpression, {
          callee: {
              type: 'Identifier',
              name: 'DEFNODE',
          }
      })
      .forEach(node => {
            const [type, props, methods, base] = node.value.arguments;
            const name = type.value;
            const propsIdent = j.identifier('props');
            const ctorStatements = [];
            // We need to copy our props, and props from our base, `AST_Node` has no base, other things with no base default to `AST_Node`
            const baseName = name == 'Node' ? 'NoBase' : base && base.name ? base.name : 'AST_Node';
            const localProps = props.value ? props.value.split(" ") : [];
            const propsList = localProps.concat(propMap[baseName]);

            propMap[`AST_${name}`] = propsList;
             // List of `this.<prop> = props.<prop>;`
             const propsAssignments = propsList.map(prop => {
                const propIdent = j.identifier(prop);
                return j.expressionStatement(
                    j.assignmentExpression('=', j.memberExpression(j.thisExpression(), propIdent), j.memberExpression(propsIdent, propIdent))
                );
            });

            if (needsInitialize.has(name)) {
                // call this.initialize();
                propsAssignments.push(j.expressionStatement(
                    j.callExpression(j.memberExpression(j.thisExpression(), j.identifier('initialize')), [])
                ))
            }
            ctorStatements.push(j.ifStatement(propsIdent, j.blockStatement(propsAssignments)));


            const ctor = j.functionDeclaration(j.identifier(`AST_${name}`), [
                propsIdent
            ], j.blockStatement([
                ...ctorStatements,
                j.expressionStatement(
                    j.assignmentExpression('=', j.memberExpression(j.thisExpression(), j.identifier('flags')), j.literal(0))
                )
            ]));

            node.value.arguments.splice(2, 0, ctor);
      })
      .toSource();
};