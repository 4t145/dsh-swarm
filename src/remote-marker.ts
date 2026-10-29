/**
 * 把 Typert Remote 标记直接安装到服务原型上的共享实现。
 *
 * `@Remote` 的标准装饰器语义被等价展开：先取标记，再以实例语义执行它注册的
 * initializer。这样源码保持 esbuild 可编译（无实验装饰器语法），而
 * `remoteMethods()` 与 Gateway 的 SRC 发现行为与生成装饰器一致。
 *
 * 边界：只适用于**公开具名实例方法**；SRC 兜底的 wire 参数名来自真实函数参数名，
 * 因此调用方必须保持简单的具名参数（可选 `signal` 只能位于末尾）。
 *
 * @module @deepseek-ai/dsh-swarm/remote-marker
 */

import { Remote, type RemoteMethodOptions } from '@deepseek-ai/dsh-typert-protocol';

type RemoteMethod = (this: object, ...args: unknown[]) => unknown;

/**
 * 在 `prototype` 上安装一个 Remote 方法标记。
 *
 * @param prototype - 拥有该方法的服务原型。
 * @param method - 公开实例方法名。
 * @param options - 仅接受 `mode: 'stream'` 与导出别名；其他协议选项不在此使用。
 */
export function markRemoteMethod(
  prototype: object,
  method: string,
  options?: Pick<RemoteMethodOptions<unknown[]>, 'mode' | 'name'>,
): void {
  const initializers: Array<(this: object) => void> = [];
  const context = {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    access: {
      has: (target: object): boolean => method in target,
      get: (target: object): RemoteMethod => Reflect.get(target, method) as RemoteMethod,
    },
    addInitializer: (initializer: (this: object) => void): void => {
      initializers.push(initializer);
    },
    metadata: undefined,
  } satisfies ClassMethodDecoratorContext<object, RemoteMethod>;
  const target = Reflect.get(prototype, method) as RemoteMethod;
  if (options?.mode === 'stream') {
    Remote({ mode: 'stream' })(target, context);
  } else if (options?.name !== undefined) {
    Remote(options.name)(target, context);
  } else {
    Remote(target, context);
  }
  const instance = Object.create(prototype) as object;
  for (const initializer of initializers) initializer.call(instance);
}
