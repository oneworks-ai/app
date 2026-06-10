export const readFormText = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim()
