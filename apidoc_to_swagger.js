var _ = require('lodash');
var { pathToRegexp } = require('path-to-regexp');
const { debug, log } = require('winston');
const GenerateSchema = require('generate-schema')


var swagger = {
    swagger: "2.0",
    info: {},
    paths: {}
};

function toSwagger(apidocJson, projectJson) {
    swagger.info = addInfo(projectJson);
    swagger.paths = extractPaths(apidocJson);
    swagger.tags = projectJson.groups || [];
    console.log(swagger.paths[0])
    console.log("\n\n\n\n\n\n\n\n\n\n\n")
    // for (const key in swagger) {
    //     console.log('[%s] %o', key, swagger[key]);
    // }
    return swagger;
}

var tagsRegex = /(<([^>]+)>)/ig;
// Removes <p> </p> tags from text
function removeTags(text) {
    return text ? text.replace(tagsRegex, "") : text;
}

function addInfo(projectJson) {
    var info = {};
    info["title"] = projectJson.title || projectJson.name;
    info["version"] = projectJson.version;
    info["description"] = projectJson.description;
    return info;
}

/**
 * Extracts paths provided in json format
 * post, patch, put request parameters are extracted in body
 * get and delete are extracted to path parameters
 * @param apidocJson
 * @returns {{}}
 */
function extractPaths(apidocJson) {
    var apiPaths = groupByUrl(apidocJson);
    var paths = {};
    for (var i = 0; i < apiPaths.length; i++) {
        var verbs = apiPaths[i].verbs;
        var url = verbs[0].url;
        var pattern = pathToRegexp(url, null);
        var matches = pattern.exec(url);

        // Surrounds URL parameters with curly brackets -> :email with {email}
        var pathKeys = [];
        for (let j = 1; j < matches.length; j++) {
            var key = matches[j].substr(1);
            url = url.replace(matches[j], "{" + key + "}");
            pathKeys.push(key);
        }

        for (let j = 0; j < verbs.length; j++) {
            var verb = verbs[j];
            var type = verb.type;

            var obj = paths[url] = paths[url] || {};

            try {
                _.extend(obj, generateProps(verb, pathKeys))
            } catch (err) {
                console.warn("Warn : Invalid APIDOC syntax in", verb.filename)
            }

        }

    }
    return paths;
}

function mapHeaderItem(i) {
    return {
        type: 'string',
        in: 'header',
        name: i.field,
        description: removeTags(i.description),
        required: !i.optional,
        default: i.defaultValue
    }
}

function mapUrlItem(i) {
    return {
        type: 'string',
        in: 'path',
        name: i.field,
        description: removeTags(i.description),
        required: !i.optional,
        default: i.defaultValue
    }
}


function mapQueryItem(i) {
    return {
        type: 'string',
        in: 'query',
        name: i.field,
        description: removeTags(i.description),
        required: !i.optional,
        default: i.defaultValue
    }
}

const defaultBodyParameter = {
    // name: 'root',
    // in: 'body',
    schema: {
        properties: {},
        type: 'object',
        required: []
    }
}

/**
 * apiDocParams
 * @param {type} type
 * @param {boolean} optional
 * @param {string} field
 * @param {string} defaultValue
 * @param {string} description
 */

/**
 * 
 * @param {ApidocParameter[]} apiDocParams 
 * @param {*} parameter 
 */
function transferApidocParamsToSwaggerBody(apiDocParams, parameterInBody) {

    let mountPlaces = {
        '': parameterInBody['schema']
    }

    apiDocParams.forEach(i => {
        const type = i.type.toLowerCase()
        const key = i.field
        const nestedName = createNestedName(i.field)
        const { objectName = '', propertyName } = nestedName

        if (type.endsWith('object[]')) {
            // if schema(parsed from example) doesn't has this constructure, init
            if (!mountPlaces[objectName]['properties'][propertyName]) {
                mountPlaces[objectName]['properties'][propertyName] = { type: 'array', items: { type: 'object', properties: {}, required: [] } }
            }

            // new mount point
            mountPlaces[key] = mountPlaces[objectName]['properties'][propertyName]['items']
        } else if (type.endsWith('[]')) {
            // if schema(parsed from example) doesn't has this constructure, init
            if (!mountPlaces[objectName]['properties'][propertyName]) {
                mountPlaces[objectName]['properties'][propertyName] = {
                    items: {
                        type: type.slice(0, -2), description: i.description,
                        // default: i.defaultValue,
                        example: i.defaultValue
                    },
                    type: 'array'
                }
            }
        } else if (type === 'object') {
            // if schema(parsed from example) doesn't has this constructure, init
            if (!mountPlaces[objectName]['properties'][propertyName]) {
                mountPlaces[objectName]['properties'][propertyName] = { type: 'object', properties: {}, required: [] }
            }

            // new mount point
            mountPlaces[key] = mountPlaces[objectName]['properties'][propertyName]
        } else {
            mountPlaces[objectName]['properties'][propertyName] = {
                type,
                description: i.description,
                default: i.defaultValue,
            }
        }
        if (!i.optional) {
            // generate-schema forget init [required]
            if (mountPlaces[objectName]['required']) {
                mountPlaces[objectName]['required'].push(propertyName)
            } else {
                mountPlaces[objectName]['required'] = [propertyName]
            }
        }
    })

    return parameterInBody
}
function generateProps(verb, pathKeys) {
    // console.log('verb', verb);

    const pathItemObject = {}
    const parameters = generateParameters(verb, pathKeys)
    const responses = generateResponses(verb)
    pathItemObject[verb.type] = {
        tags: [verb.group],
        summary: verb.title ? removeTags(verb.title) : removeTags(verb.name),
        description: verb.description ? removeTags(verb.description) : "",
        consumes: [
            "application/json"
        ],
        produces: [
            "application/json"
        ],
        parameters,
        responses
    }

    return pathItemObject

}

function generateParameters(verb, pathKeys) {
    const mixedUrl = []
    const mixedQuery = []
    const mixedBody = []
    const header = verb && verb.header && verb.header.fields.Header || []

    if (verb && verb.parameter && verb.parameter.fields) {

        const UrlParameter = verb.parameter.fields.Url || verb.parameter.fields.Param || verb.parameter.fields.Params || []
        const Parameter = verb.parameter.fields.Parameter || []

        const _others = []

        Parameter.forEach(param => {
            if (pathKeys.includes(param.field)) {
                UrlParameter.push(param)
            } else {
                _others.push(param)
            }
        })

        const _query = verb.parameter.fields.Query || []
        const _body = verb.parameter.fields.Body || []

        mixedUrl.push(...UrlParameter)

        mixedQuery.push(..._query)
        mixedQuery.push(..._others)
        if (verb.type === 'get') {
            mixedQuery.push(..._body)
        } else {
            mixedBody.push(..._body)
            // mixedBody.push(...Parameter)
        }
    }

    const parameters = []
    parameters.push(...mixedUrl.map(mapUrlItem))
    parameters.push(...mixedQuery.map(mapQueryItem))
    parameters.push(...header.map(mapHeaderItem))
    if (mixedBody.length > 0)
        parameters.push(generateRequestBody(verb, mixedBody))
    // console.log('parameters', parameters);

    return parameters
}
function generateRequestBody(verb, mixedBody) {
    const bodyParameter = {
        in: 'body',
        schema: {
            properties: {},
            type: 'object',
            required: []
        },
        name: "payload"
    }

    if (_.get(verb, 'parameter.examples.length') > 0) {
        for (const example of verb.parameter.examples) {
            const { code, json } = safeParseJson(example.content)
            const schema = GenerateSchema.json(example.title, json)
            bodyParameter.schema = schema
            bodyParameter.description = example.title
        }
    }

    transferApidocParamsToSwaggerBody(mixedBody, bodyParameter)

    return bodyParameter
}

function generateResponses(verb) {
    const success = verb.success
    const responses = {
        200: {
            schema: {
                properties: {},
                type: 'object',
                required: []
            }
        }
    }
    if (success && success.examples && success.examples.length > 0) {
        for (const example of success.examples) {
            const { code, json } = safeParseJson(example.content)
            const schema = GenerateSchema.json(example.title, json)

            const properties = schema.properties;
            for (let prop in properties) {
                let propSchema = properties[prop];
                if (propSchema.items && propSchema.items.type === "array") {
                    let innerSchema = GenerateSchema.json(prop, json[prop][0]);

                    propSchema.items.items = innerSchema.items;
                }
            }


            responses[code] = { schema, description: example.title }
        }

    }

    mountResponseSpecSchema(verb, responses)

    return responses
}



function mountResponseSpecSchema(verb, responses) {
    // if (verb.success && verb.success['fields'] && verb.success['fields']['Success 200']) {
    if (_.get(verb, 'success.fields.Success 200')) {
        const apidocParams = verb.success['fields']['Success 200']
        responses[200] = transferApidocParamsToSwaggerBody(apidocParams, responses[200])
    }
}

function safeParseJson(content) {
    // such as  'HTTP/1.1 200 OK\n' +  '{\n' + ...
    const leftCurlyBraceIndex = content.indexOf('{')
    const leftSquareBraceIndex = content.indexOf('[')

    const startingPoint = content.length > 0 && content.trim()[0] === '[' ? leftSquareBraceIndex : leftCurlyBraceIndex;

    const mayCodeString = content.slice(0, startingPoint)
    const mayContentString = content.slice(startingPoint)

    const mayCodeSplit = mayCodeString.trim().split(' ')
    const code = mayCodeSplit.length === 3 ? parseInt(mayCodeSplit[1]) : 200

    let json = {}
    try {
        json = JSON.parse(mayContentString)
    } catch (error) {
        console.warn('parse error', error)
    }

    return {
        code,
        json
    }
}


function createNestedName(field, defaultObjectName) {
    let propertyName = field;
    let objectName;
    let propertyNames = field.split(".");
    if (propertyNames && propertyNames.length > 1) {
        propertyName = propertyNames.pop();
        objectName = propertyNames.join(".");
    }

    return {
        propertyName: propertyName,
        objectName: objectName || defaultObjectName
    }
}

function groupByUrl(apidocJson) {
    let order = { "get": 1, "post": 2, "put": 3, "delete": 4 }
    apidocJson = apidocJson.map(a => {
        a.order = order[a.type]
        return a
    })
    return _.chain(apidocJson)
        .sortBy("order")
        .groupBy("url")
        .toPairs()
        .map(function (element) {
            return _.zipObject(["url", "verbs"], element);
        })
        .value();
}

module.exports = {
    toSwagger: toSwagger
};