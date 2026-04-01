export function to<T, U = Error>(
  promise: Promise<T>,
  errorExt?: object
): Promise<[U, undefined] | [null, T]> {
  return promise
    .then<[null, T]>((data: T) => [null, data])
    .catch<[U, undefined]>((err: U) => {
      if (errorExt) {
        const parsedError = Object.assign({}, err, errorExt);
        return [parsedError, undefined];
      }
      return [err, undefined];
    });
}

export function parseDateString(dateString: string): Date {
  // 定义正则表达式解析自定义时间格式
  // 正则表达式解析时间字符串
  const regex = /(\w+) (\w+) (\d+) (\d+):(\d+):(\d+) ([+-]\d{4}) (\d{4})/;
  const match = dateString.match(regex);

  if (!match) {
    throw new Error("Invalid date format");
  }

  const [, , month, day, hour, minute, second, timezone, year] = match;

  // 月份映射
  const monthMap: { [key: string]: number } = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
  };

  // 创建UTC时间
  const date = new Date(Date.UTC(
    parseInt(year, 10),
    monthMap[month],
    parseInt(day, 10),
    parseInt(hour, 10),
    parseInt(minute, 10),
    parseInt(second, 10)
  ));

  // 处理时区偏移（例如 +0800）
  const timezoneOffsetHours = parseInt(timezone.slice(0, 3), 10);
  const timezoneOffsetMinutes = parseInt(timezone.slice(0, 1) + timezone.slice(3), 10);
  const timezoneOffset = timezoneOffsetHours * 60 + timezoneOffsetMinutes;

  // 调整时间为本地时区
  date.setUTCMinutes(date.getUTCMinutes() - timezoneOffset);

  return date;
}

export function checkWords(params: any, message: string): boolean {
  if (message == null)
    return false
  const normalizeWordList = (value: unknown) => {
    if (Array.isArray(value)) return value.filter(Boolean).map(item => String(item).trim()).filter(Boolean)
    if (typeof value === 'string') return value.split(';').map(item => item.trim()).filter(Boolean)
    return []
  }
  let keywordsList = normalizeWordList(params.keywords)
  let blockwordsList = normalizeWordList(params.blockwords)
  if (keywordsList.length > 0) {
    let hasKeywords = false
    for (const keyword of keywordsList) {
      if (message.includes(keyword)) {
        hasKeywords = true
        break
      }
    }
    if (!hasKeywords) {
      return false
    }
  }
  if (blockwordsList.length > 0) {
    let hasBlockwords = false
    for (const blockword of blockwordsList) {
      if (message.includes(blockword)) {
        hasBlockwords = true
        break
      }
    }
    if (hasBlockwords) {
      return false
    }
  }
  return true
}

export function stripHtmlTags(html: string): string {
  if (!html) return ''

  let text = html

  text = text.replace(/<br\s*\/?>/gi, '\n')

  text = text.replace(/<span\s+class=['"]surl-text['"][^>]*>([^<]*)<\/span>/gi, '$1')

  text = text.replace(/<img[^>]*>/gi, '')

  // 使用循环直到不再有变化，以处理多层嵌套
  let lastText = ''
  let iterations = 0
  while (text !== lastText && iterations < 10) {
    lastText = text
    // 匹配 <a> 标签，提取其内容（但不包括已处理的 surl-text）
    text = text.replace(/<a[^>]*>([^<]*(?:<[^>]*>[^<]*<\/[^>]*>[^<]*)*)<\/a>/gi, '$1')
    iterations++
  }

  text = text.replace(/<[^>]+>/g, '')

  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")
  text = text.replace(/&apos;/g, "'")
  text = text.replace(/&amp;/g, '&')

  text = text.replace(/[ \t]+/g, ' ') // 将多个空格/制表符合并为一个空格
  text = text.replace(/\n[ \t]+/g, '\n') // 去除换行后的空格
  text = text.replace(/[ \t]+\n/g, '\n') // 去除换行前的空格
  text = text.replace(/\n{3,}/g, '\n\n') // 最多保留两个连续换行
  text = text.trim()

  return text
}
