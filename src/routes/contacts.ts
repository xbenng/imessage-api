import { Hono } from "hono";
import { getContactMap } from "../lib/contacts.js";

const contacts = new Hono();

contacts.get("/", (c) => {
  const map = getContactMap();
  return c.json(map);
});

export default contacts;
