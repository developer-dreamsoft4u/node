/**
 * API Definitions for login of user
 */
import Joi from 'joi';
import { keys } from 'memory-cache';
const types = [
    'facebook',
    'google',
    'twitter'
]
/**
 * Schema for create
 * @type {{password: *, email: *}}
 */
const createSchema = {
    email: Joi.string().required().email(),
    password: Joi.string().required()
};

/**
 * Response schema
 * @type Object
 */
const createResponseSchema = {
    uid: Joi.any(),
    displayName: Joi.any(),
    photoURL: Joi.any(),
    email: Joi.any(),
    emailVerified: Joi.any(),
    accessToken: Joi.any(),
    refreshToken: Joi.any()
};

/**
 * Create Method configuration
 */
const create = {
    method: async function (obj) {
        const { firebaseCommon } = this;
        const { email, password } = obj;
        let response = await firebaseCommon.authenticateLocal(email, password);
        response = response.user.toJSON();
        response.accessToken = response.stsTokenManager.accessToken;
        response.refreshToken = response.stsTokenManager.refreshToken;
        return response;

    },
    validateSchema: createSchema,
    responseSchema: createResponseSchema
};

function checkRoleAuthorization(role, req, res) {
    let status = true;
    if (role instanceof Array) {
        status = req.user && role.indexOf(req.user.role) !== -1
    } else {
        status = req.user && req.user.role === role;
    }
    if (!status) {
        throw {
            status: 403,
            message: "You do not have access to this API"
        }
    }
}

function checkAdminAuthorization(req, res) {
    checkRoleAuthorization("admin", req, res);
}

export default {
    create,
    disableNotDefinedMethods: true,
};
export {
        checkRoleAuthorization,
    checkAdminAuthorization
}
