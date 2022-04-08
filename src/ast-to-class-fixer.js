const j = require('jscodeshift');

// Hard code a list of the nodes that have an `initialize` method.
const NEEDS_INITIALIZE = new Set(['Call', 'New', 'Label']);

module.exports = function(fileInfo, api) {

    const root = api.jscodeshift(fileInfo.source);

    root.find(j.VariableDeclaration).filter(node => {
        return node.value.declarations[0].init &&
            node.value.declarations[0].init.type == 'CallExpression' &&
            node.value.declarations[0].init.callee.type == 'Identifier' &&
            node.value.declarations[0].init.callee.name == 'DEFNODE'
    }).replaceWith(node => {
        const [type, props, methods, base] = node.value.declarations[0].init.arguments;
        const name = type.value;

        const ctor = buildCtor(name, props);

        const classVars = buildClassVars(methods);
        const classMethods = buildClassMethods(methods);

        if (name  == 'Node') {
            const nameId = j.identifier('name');
            const methodId = j.identifier('method');
            const thisProto = j.memberExpression(j.thisExpression(), j.identifier('prototype'));
            classMethods.push(
                j.methodDefinition('method', j.identifier('DEFMETHOD'), j.functionExpression(null, [nameId, methodId], j.blockStatement([
                    j.expressionStatement(j.assignmentExpression('=', j.memberExpression(thisProto, nameId, true), methodId))
                ])), true)
            )

        }

        const typeId = j.identifier('TYPE');
        const baseClass = name == 'Node' ? null : j.identifier(base && base.name ? base.name : 'AST_Node');
        const classNameId = j.identifier(`AST_${name}`);
        return j.classDeclaration(classNameId, j.classBody([
            j.classProperty(typeId, j.literal(name), null, true),
            j.classProperty(typeId, j.literal(name), null, false),
            j.classProperty(j.identifier('CTOR'), classNameId),
            ...classVars,
            ctor,
            ...classMethods,
        ]), baseClass);

    });
    // console.log(MozToMe);
    return root.toSource();
};

function buildCtor(name, props) {
    const propsIdent = j.identifier('props');

    const ctorStatements = [];
    if (name !== 'Node') {
        // super(props)
        ctorStatements.push(j.expressionStatement(j.callExpression(j.super(), [propsIdent])));
    } else {
        // this.flags = 0;
        ctorStatements.push(j.expressionStatement(
            j.assignmentExpression('=', j.memberExpression(j.thisExpression(), j.identifier('flags')), j.literal(0))
        ));
    }

    const localProps = props.value ? props.value.split(" ") : [];

    // List of `this.<prop> = props.<prop>;`
    const propsAssignments = localProps.map(prop => {
        const propIdent = j.identifier(prop);
        return j.expressionStatement(
            j.assignmentExpression('=', j.memberExpression(j.thisExpression(), propIdent), j.memberExpression(propsIdent, propIdent))
        );
    });

    if (NEEDS_INITIALIZE.has(name)) {
        // this.initialize();
        propsAssignments.push(j.expressionStatement(
            j.callExpression(j.memberExpression(j.thisExpression(), j.identifier('initialize')), [])
        ))
    }
    if (propsAssignments.length !== 0) {
        ctorStatements.push(j.ifStatement(propsIdent, j.blockStatement(propsAssignments)));
    }

    return j.methodDefinition('constructor', j.identifier('constructor'), j.functionExpression(null, [
        propsIdent
    ], j.blockStatement([
        ...ctorStatements,
    ])));
}

function buildClassVars(methods) {
    const staticVars = methods.properties.filter(prop => {
        return prop.key.name.startsWith('$')
    }).map(staticConst => {
        return j.classProperty(j.identifier(staticConst.key.name.substr(1)), staticConst.value, null, true);
    });

    const nonStaticVars = methods.properties.filter(prop => {
        return !prop.key.name.startsWith('$') && (prop.value.type !== 'FunctionExpression' && prop.value.type !== 'ArrowFunctionExpression');
    }).map(nonStaticVar => {
        return j.classProperty(j.identifier(nonStaticVar.key.name), nonStaticVar.value, null, false);
    });

    return staticVars.concat(nonStaticVars);


}

function buildClassMethods(methods) {
    return methods.properties.filter(prop => {
        return prop.value.type === 'FunctionExpression' || prop.value.type === 'ArrowFunctionExpression';
    }).map(method => {
        if (method.value.type === 'FunctionExpression') {
            // console.log(method);
            return j.methodDefinition('method', j.identifier(method.key.name), method.value);
        } else {
            // console.log(method);
            // console.log(method.value);
            return j.methodDefinition('method', j.identifier(method.key.name),
                j.functionExpression(null, method.value.params, method.value.body)
            );
        }
        // return j.classProperty(j.identifier(nonStaticVar.key.name), nonStaticVar.value, null, false);
    });
}