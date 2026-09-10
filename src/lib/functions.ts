import { httpsCallable, type HttpsCallableResult } from "firebase/functions";
import { functions } from "./firebase";

/**
 * Call a Firebase Callable Cloud Function.
 *
 * Usage:
 *   const result = await callFunction<RequestData, ResponseData>("myFunction", { foo: "bar" });
 */
export async function callFunction<TData = unknown, TResult = unknown>(
  name: string,
  data?: TData
): Promise<TResult> {
  const fn = httpsCallable<TData, TResult>(functions, name);
  const result: HttpsCallableResult<TResult> = await fn(data as TData);
  return result.data;
}
