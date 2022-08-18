/**
 * API Definitions for users
 */
import Joi from "joi";
import {
  getNonDefinedValuesObject,
  isValidEmail,
} from "arivaa-utils/lib/common";
import { get as getMethod, update as updateMethod } from "../generic";
import { getArray } from "../../utils/arrayutil";

/**
 * Schema for create
 * @type {{photoURL: *, password: *, phoneNumber: *, displayName: *, email: *}}
 */
const createSchema = {
  type: Joi.valid("social", "local").required(),
  name: Joi.string().required(),
  providerId: Joi.string().when("type", {
    is: "social",
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  uid: Joi.string().when("type", {
    is: "social",
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  email: Joi.string().email().optional(),
  password: Joi.string().when("type", {
    is: "local",
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  phoneNumber: Joi.string(),
  photoURL: Joi.string(),
  role: Joi.string(),
  emailVerified: Joi.boolean(),
};

/**
 * Schema for update
 * @type {{photoURL: *, password: *, phoneNumber: *, displayName: *, email: *}}
 */
const updateSchema = {
  name: Joi.string(),
  email: Joi.string().email(),
  password: Joi.string(),
  phoneNumber: Joi.string(),
  photoURL: Joi.string(),
  emailVerified: Joi.boolean(),
  disabled: Joi.boolean(),
  role: Joi.string(),
};
/**
 * Create Configuration
 */
const create = {
  method: async function (input, req, res) {
    const adminRequest = typeof req !== "undefined";
    let {
      name,
      email,
      password,
      phoneNumber,
      photoURL,
      role,
      emailVerified,
      type,
      uid,
    } = input;
    const ids = await this.firebaseAdmin.getRecord("/ids");
    const { users } = ids || {};
    const id = (users || 0) + 1;
    let output;
    role = role || this.config.defaultUserRole;
    let profile = {
      id,
      role,
    };
    if (type === "social") {
      role = this.config.defaultUserRole;
      input.id = id;
      input.key = uid;
      input.displayName = input.name;
      output = {
        ...(await this.firebaseAdmin.updateUser(uid, {
          emailVerified,
        })),
        profile: await this.firebaseAdmin.updateUserProfile(uid, profile),
      };
    } else {
      const extra = getNonDefinedValuesObject({
        displayName: name,
        phoneNumber,
        photoURL,
      });
      /**
       * If this API is directly called externally, Means Admin has
       * created the user in which case if confirmation of user is required i,e confirmNewUserAdmin is true
       * We set emailVerified to what we get from request body else we simply by default confirm the user
       */

      if (adminRequest) {
        if (this.config.confirmNewUserAdmin) {
          extra.emailVerified = !!emailVerified;
        } else {
          extra.emailVerified = true;
        }
      } else {
        extra.emailVerified = !!emailVerified;
      }
      output = await this.firebaseAdmin.createLocalUser(
        email,
        password,
        profile,
        extra
      );

      /**
       * Send Username and Password to the email
       * in case of admin
       * In case Email is not verified if confirmNewUserAdmin = true,
       * then user will get a message when he logs in to actually have it verified by admin
       * as it makes no sense to do the verification process in this case.
       */
      if (adminRequest) {
        (async () => {
          if (email && name && password) {
            this.service("emails").create({
              to: email,
              template: "WelcomeUserAdmin",
              data: {
                email,
                displayName: name,
                password,
                link: await this.helper("generateWebClientLink")("login"),
              },
            });
          }
        })();
      }
    }
    output = {
      ...output,
      ...output.profile,
      key: output.uid,
    };
    output.createdAt =
      output.metadata &&
      output.metadata.creationTime &&
      new Date(output.metadata.creationTime).getTime();
    delete output.profile;
    output.customClaims = {
      role,
      id,
    };
    return output;
  },
  validateSchema: createSchema,
};
/**
 * Get All Configuration
 */
const findByAuth = {
  method: async function (input) {
    const { nextPageToken, count } = input;
    const result = await this.firebaseAdmin.getUsers(
      parseInt(count),
      nextPageToken
    );
    return result;
  },
};

/**
 * Find in /users path
 */
const find = {
  validateSchema: {
    role: Joi.string().optional(),
  },
  onAfter: async function (output, input) {
    if (input.all) {
      await getArray(output, async (item) => {
        const { key } = item;
        item.user = await this.firebaseAdmin.getFullUserById(key);
        Object.keys(item.user || {}).forEach((key) => {
          item[key] = item.user[key];
        });
        item.createdAt =
          item.metadata &&
          item.metadata.creationTime &&
          new Date(item.metadata.creationTime).getTime();
        delete item.user;
      });
    }
  },
};

/**
 * Update Configuration
 */
const update = {
  method: async function (id, input) {
    const {
      name,
      email,
      password,
      phoneNumber,
      photoURL,
      emailVerified,
      role,
      disabled,
    } = input;
    const result = await this.firebaseAdmin.updateUser(
      id,
      getNonDefinedValuesObject({
        displayName: name,
        phoneNumber,
        email,
        password,
        photoURL,
        emailVerified,
        disabled,
      })
    );
    const profile = await this.firebaseAdmin.updateUserProfile(
      id,
      getNonDefinedValuesObject({
        role,
      })
    );
    return {
      ...result,
      ...profile,
      key: id,
    };
  },
  validateSchema: updateSchema,
};

/**
 * Remove Configuration
 */

const remove = {
  method: async function (id) {
    try {
      const result = await this.firebaseAdmin.deleteUser(id);
      return true;
    } catch (e) {
      console.log("Error while deleting user");
      return false;
    }
  },
};

/**
 * Get Current User
 */
const getCurrent = {
  callback: async function (req, res) {
    const user = await this.service("users").get({ id: req.user.uid });
    const { role } = user;
    const { data } = await this.service("roles").find({
      search: role,
      searchField: "code",
      operator: "equals",
    });
    if (data && data.length) {
      const [{ permissions }] = data;
      if (permissions.length) {
        try {
          const data = await this.service("permission").get({
            id: permissions.join(","),
          });
          if (Array.isArray(data)) {
            user.permissions = data;
          } else {
            user.permissions = [data];
          }
          user.permissions = user.permissions.map(({ key }) => {
            return key;
          });
        } catch (e) {
          console.error("Error while getting permissions - ", permissions, {
            e,
          });
        }
      }
    }
    return user;
  },
  security: true,
};

/**
 * Update Current User
 */
const updateCurrent = {
  callback: async function (req, res) {
    req.params.id = req.user.uid;
    return updateMethod.apply(
      {
        ...this,
        update: {
          validateSchema: {
            name: Joi.string(),
            email: Joi.string().email(),
            oldPassword: Joi.string().when("password", {
              is: Joi.exist(),
              then: Joi.required(),
              otherwise: Joi.optional(),
            }),
            password: Joi.string(),
            phoneNumber: Joi.string(),
            photoURL: Joi.string(),
          },
          onBefore: async (obj) => {
            if (obj.data && (obj.data.password || obj.data.email)) {
              const user = req.user;

              try {
                await this.firebaseCommon.authenticateLocal(
                  user.email,
                  obj.data.oldPassword
                );
              } catch (e) {
                throw {
                  status: 403,
                  message: "Old Password is incorrect",
                };
              }
            }
            delete obj.data.oldPassword;
          },
          method: update.method,
        },
      },
      arguments
    );
  },
  method: "PATCH",
  security: true,
};

/**
 * Security Settings for this API
 */
const security = {
  //role: "admin",
  defaultPermissions : true
};

export default {
  security,
  find,
  indexingConfig: function (input) {
    return {
      fields: ["displayName", "role", "email"],
      preFilter:
        input && input.role
          ? function ({ role }) {
              return role === input.role;
            }
          : undefined,
      populateIndex: async function () {
        const { firebaseAdmin } = this;
        const pageSize = 5;
        let { users, pageToken } = await firebaseAdmin.getUsers(pageSize);
        while (pageToken) {
          let {
            users: nextData,
            pageToken: nextPageToken,
          } = await firebaseAdmin.getUsers(pageSize, pageToken);
          users = [...users, ...nextData];
          pageToken = nextPageToken;
        }
        const profiles = (await this.firebaseAdmin.getRecord("/users")) || {};

        let finalUsers = [];
        users.forEach((user) => {
          if (profiles[user.uid]) {
            finalUsers.push({
              ...user.toJSON(),
              ...profiles[user.uid],
              key: user.uid,
              createdAt: new Date(user.metadata.creationTime).getTime(),
            });
          }
        });
        return finalUsers;
      },
    };
  },
  create,
  findByAuth,
  update,
  remove,
  additionalPaths: {
    "current/get": getCurrent,
    "current/update": updateCurrent,
  },
};
