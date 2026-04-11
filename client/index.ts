import type { Context } from "@koishijs/client";
import Login from "./login.vue";

export default (ctx: Context) => {
  ctx.slot({
    type: "plugin-details",
    component: Login,
    order: 0,
  });
};
