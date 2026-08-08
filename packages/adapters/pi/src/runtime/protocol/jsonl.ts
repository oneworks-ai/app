export class JsonlDecoder {
  private buffer = ''

  push(chunk: string): string[] {
    this.buffer += chunk
    const records: string[] = []
    let separator = this.buffer.indexOf('\n')
    while (separator >= 0) {
      const raw = this.buffer.slice(0, separator)
      this.buffer = this.buffer.slice(separator + 1)
      const record = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (record.trim() !== '') records.push(record)
      separator = this.buffer.indexOf('\n')
    }
    return records
  }

  finish(): string[] {
    const raw = this.buffer
    this.buffer = ''
    const record = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    return record.trim() === '' ? [] : [record]
  }
}
