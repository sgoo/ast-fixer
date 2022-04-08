const j = require('jscodeshift');

module.exports = function(fileInfo, api) {

    const root = api.jscodeshift(fileInfo.source);

    root.find(j.CallExpression, {
        callee: {
            type: 'Identifier',
            name: 'mkshallow',
        }
    }).replaceWith(node => {
        const [props] = node.value.arguments;
        const expression = props.properties.map(prop => {
            let thisProp;
            let otherProp;
            if(prop.key.type === 'Identifier') {
                thisProp = j.memberExpression(j.thisExpression(), j.identifier(prop.key.name));
                otherProp = j.memberExpression(j.identifier('other'), j.identifier(prop.key.name));
            } else if(prop.key.type === 'Literal') {
                if (prop.key.value.includes('.')) {
                    const [first, second] = prop.key.value.split('.');
                    thisProp = j.memberExpression(j.memberExpression(j.thisExpression(), j.identifier(first)), j.identifier(second));
                    otherProp = j.memberExpression(j.memberExpression(j.identifier('other'), j.identifier(first)), j.identifier(second));
                } else {
                    thisProp = j.memberExpression(j.thisExpression(), j.identifier(prop.key.value));
                    otherProp = j.memberExpression(j.identifier('other'), j.identifier(prop.key.value));
                }
            } else {
                throw new Error("Unknown type");
            }
            if (prop.value.value == 'eq') {
                // this.prop1 === other.prop1
                return j.binaryExpression('===', thisProp, otherProp);
            } else if(prop.value.value == 'exist') {
                // (this.prop2 == null ? other.prop2 == null : this.prop2 === other.prop2)
                return j.conditionalExpression(
                    j.binaryExpression('==', thisProp, j.literal(null)),
                    j.binaryExpression('==', otherProp, j.literal(null)),
                    j.binaryExpression('===', thisProp, otherProp),
                )
            } else {
                throw Error(`Unknown condition type: ${prop.value.value}`);
            }
        }).reduce((left, right) => {
            if (left) {
                return j.logicalExpression('&&', left, right)
            }
            return right;
        });

        return j.functionDeclaration(null, [j.identifier('other')], j.blockStatement([
            j.returnStatement(expression)
        ]));

    });
    return root.toSource();
};