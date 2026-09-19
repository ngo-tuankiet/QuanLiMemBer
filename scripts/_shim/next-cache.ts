/** Giả lập `next/cache`: ghi lại đường dẫn được revalidate thay vì gọi Next. */

export const daRevalidate: string[] = [];

export function revalidatePath(path: string): void {
  daRevalidate.push(path);
}

export function revalidateTag(tag: string): void {
  daRevalidate.push(`tag:${tag}`);
}
