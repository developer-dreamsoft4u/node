import Joi from "joi";
import {
  checkServiceKeyDuplicacy,
  checkValidKeyInServiceForMany,
  getRecord,
} from "../helpers/common";
const createSchema = {
  key: Joi.string().required(),
  customerName: Joi.string().required(),
  address: Joi.string().required(),
  homeNumber: Joi.string().optional().allow("", null),
  officeNumber: Joi.string().optional().allow("", null),
  email: Joi.string().required(),
  products: Joi.array().items(Joi.string()).allow([], null),
  createUser: Joi.boolean(),
};
const updateSchema = {
  //corporateNumber: Joi.string(),
  customerName: Joi.string(),
  address: Joi.string(),
  homeNumber: Joi.string().allow("", null),
  key: Joi.string(),
  officeNumber: Joi.string().allow("", null),
  email: Joi.string(),
  products: Joi.array().items(Joi.string()).allow([], null),
  userUid: Joi.string(),
};
const create = {
  validateSchema: createSchema,
  onBefore: async function (input, req, res) {
    await checkServiceKeyDuplicacy.apply(this, ["customer", input, "customer"]);
    await checkValidKeyInServiceForMany.apply(this, [
      "products",
      input.products || [],
    ]);
    if (input.createUser) {
      req.createUser = input.createUser;
      delete input["createUser"];
    }
  },
  onAfter: async function (output, input, req, res) {
    const { key } = output;
    const { createUser } = req;
    let userResponse;
    let password = Math.random().toString(36).slice(-10);
    if (createUser) {
      userResponse = await this.service("users").create(
        {
          type: "local",
          name: output.customerName,
          role: "CUSTOMER",
          email: output.email,
          password,
        },
        true
      );
    }
    if (userResponse) {
      await this.service("customer").update({
        id: key,
        data: {
          userUid: userResponse.uid,
        },
      });
    }
  },
};
/**
 *  In on after we are getting the products and displaying with the products
 */
let get = {
  onAfterEach: async function (output, id) {
    if (output.products && output.products.length) {
      try {
        output.products = await this.service("products").get({
          id: output.products.join(","),
        });
      } catch (e) {
        console.error("Error while getting products for customer", { e, id });
        output.products = [];
      }
    }
  },
};
/**
 * Like get we are fetching the products and displaying it with the customers
 */
let find = {
  onAfter: async function (output) {
    if (output.data && output.data.length) {
      output.data = await Promise.all(
        output.data.map(async (customer) => {
          customer = {
            ...customer,
          };
          if (customer.products && customer.products.length) {
            try {
              customer.products = await this.service("products").get({
                id: customer.products.join(","),
              });
            } catch (e) {
              console.error("Error while getting products for customer", {
                e,
                customer,
              });
              customer.products = [];
            }
          }
          return customer;
        })
      );
    }
  },
};
const update = {
  overrideIfNotExist: true,
  validateSchema: updateSchema,
  onBefore: async function (input) {
    const { id, data } = input;
    const { key } = data;
    if (key && key !== id) {
      // getting old customer
      const {
        updatedAt,
        updatedBy,
        createdAt,
        createdBy,
        ...customer
      } = await this.service("customer").get({
        id,
      });
      // creating new customer
      await this.service("customer").create({
        ...customer,
        key,
      });
      // deleting old customer
      await this.service("customer").remove({
        id,
      });
      input.id = key;
      input.data = {
        ...customer,
        ...data,
      };
    }
  },
};
export default {
  security: {
    defaultPermissions: true,
  },
  indexingConfig: {
    fields: ["customerName", "key", "userUid"],
  },
  create,
  update,
  get,
  remove: {
    onBeforeEach: async function (id) {
      const removeUserAndJobsAndInvoices = () => {
        setTimeout(async () => {
          console.debug("Removing customer with phone - " + id);
          const customer = await getRecord.apply(this, ["customer", id]);
          if (customer) {
            const customerJobs = await this.service("service").find({
              search: id,
              searchField: "customerKey",
              operator: "equals",
            });
            const customerInvoices = await this.service("service").find({
              search: id,
              searchField: "customerKey",
              operator: "equals",
            });
            if (customer.userUid) {
              console.debug("Removing user for customer");
              await this.service("users").remove({
                id: customer.userUid,
              });
            }
            if (customerJobs && customerJobs.total > 0) {
              console.debug(
                "Removing jobs for customer, count - ",
                customerJobs.total
              );
              await this.service("service").remove({
                id: customerJobs.data
                  .map(({ key }) => {
                    return key;
                  })
                  .join(","),
              });
            }
            if (customerInvoices && customerInvoices.total > 0) {
              console.debug(
                "Removing invoices for customer, count - ",
                customerInvoices.total
              );
              await this.service("invoice").remove({
                id: customerInvoices.data
                  .map(({ key }) => {
                    return key;
                  })
                  .join(","),
              });
            }
          }
        });
      };
      removeUserAndJobsAndInvoices();
    },
  },
  find,
};
