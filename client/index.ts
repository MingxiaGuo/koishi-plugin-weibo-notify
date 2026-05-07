import type { Context } from "@koishijs/client";
import Login from "./login.vue";

export default (ctx: Context) => {
  console.log("[weibo-notify] WebUI plugin loaded!");
  ctx.slot({
    type: "plugin-details",
    component: Login,
    order: -100,
  });
};
