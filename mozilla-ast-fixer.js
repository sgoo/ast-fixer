const j = require('jscodeshift');

module.exports = function(fileInfo, api) {

    const root = api.jscodeshift(fileInfo.source);

    const MozToMe = root.find(j.VariableDeclarator, {
        id: {
            type: 'Identifier',
            name: 'MOZ_TO_ME',
        }
    }).nodes()[0];
    const mozToMeProperties = MozToMe.init.properties;

    root.find(j.CallExpression, {
        callee: {
            type: 'Identifier',
            name: 'map',
        }
    }).replaceWith(node => {
        const [moztype, mytype, propmap] = node.value.arguments;

        const fromObjectProperties = [
            j.property('init', j.identifier('start'), j.callExpression(j.identifier('my_start_token'), [j.identifier('M')])),
            j.property('init', j.identifier('end'), j.callExpression(j.identifier('my_end_token'), [j.identifier('M')]))
        ];

        const toObjectProperties = [
            j.property('init', j.identifier('type'), j.literal(moztype.value)),
        ]


        if (propmap) {
            propmap.value.split(/\s*,\s*/).forEach(prop => {
                const m = /([a-z0-9$_]+)([=@>%])([a-z0-9$_]+)/i.exec(prop);
                if (!m) throw new Error("Can't understand property map: " + prop);

                const moz = m[1], how = m[2], my = m[3];
                const mDotMoz = j.memberExpression(j.identifier('M'), j.identifier(moz));
                const mDotMy = j.memberExpression(j.identifier('M'), j.identifier(my));

                let fromValue;
                let toValue;
                switch (how) {
                    case "@":
                        fromValue = j.callExpression(j.memberExpression(mDotMoz, j.identifier('map')), [j.identifier('from_moz')]);
                        toValue = j.callExpression(j.memberExpression(mDotMy, j.identifier('map')), [j.identifier('to_moz')]);
                        break;
                    case ">":
                        fromValue = j.callExpression(j.identifier('from_moz'), [mDotMoz]);
                        toValue = j.callExpression(j.identifier('to_moz'), [mDotMy]);
                        break;
                    case "=":
                        fromValue = mDotMoz;
                        toValue = mDotMy;
                        break;
                    case "%":
                        fromValue = j.memberExpression(j.callExpression(j.identifier('from_moz'), [mDotMoz]), j.identifier('body'));
                        toValue = j.callExpression(j.identifier('to_moz_block'), [j.identifier('M')]);
                        break;
                    default:
                        throw new Error("Can't understand operator in propmap: " + prop);
                }

                fromObjectProperties.push(j.property('init', j.identifier(my), fromValue));
                toObjectProperties.push(j.property('init', j.identifier(moz), toValue));
            });
        }

        const mozToMeProp = j.property('init', j.identifier(moztype.value), j.functionExpression(null, [j.identifier("M")],
            j.blockStatement([
                j.returnStatement(
                    j.newExpression(j.identifier(mytype.name), [j.objectExpression(fromObjectProperties)])
                )
            ])
        ));
        mozToMeProperties.push(mozToMeProp);

        const defToMoz = j.callExpression(j.identifier('def_to_moz'), [j.identifier(mytype.name),
            j.functionExpression(j.identifier(`To_Moz_${moztype.value}`), [j.identifier('M')], j.blockStatement([
                j.returnStatement(j.objectExpression(toObjectProperties))
            ]))]);

        return defToMoz;
    });
    return root.toSource();
};