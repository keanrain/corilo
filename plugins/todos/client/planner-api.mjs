export function createPlannerApi(identity) {
  async function call(method, args = {}) {
    let result;
    try {
      const r = await fetch(`api/corilo-todos/v2/${method}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-corilo-todos-id": identity,
        },
        body: JSON.stringify(args),
      });
      if (!r.ok) throw Error();
      result = await r.json();
      if (typeof result.ok !== "boolean") throw Error();
    } catch {
      throw Object.assign(Error("连接失败，输入已保留，请核对操作结果"), {
        unknown: true,
      });
    }
    if (!result.ok)
      throw Object.assign(Error(result.error.message), {
        code: result.error.code,
        unknown: result.error.code === "schedule/503",
      });
    return result.value;
  }
  return call;
}
