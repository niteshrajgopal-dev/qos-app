import { WorkbookParseError } from "@/lib/workbook/errors";

/* A small, strict XML tokenizer for the SpreadsheetML parts of an uploaded
   workbook. It has no notion of DTDs: any `<!DOCTYPE` or `<!ENTITY` is
   refused, so external entities and entity expansion ("billion laughs")
   cannot happen, and nothing is ever fetched. Only the five predefined
   entities and numeric character references are decoded. Element and
   attribute names are reported without their namespace prefix, because
   valid workbooks may write `<x:row>` as well as `<row>`. */

export type XmlAttributes = Record<string, string>;

export type XmlHandlers = {
  open?: (name: string, attributes: XmlAttributes, selfClosing: boolean) => void;
  close?: (name: string) => void;
  text?: (text: string) => void;
};

const MAX_DEPTH = 128;

const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

function malformed(detail: string): never {
  throw new WorkbookParseError("malformed_workbook", `The workbook XML is not readable (${detail}).`);
}

function localName(qualified: string) {
  const colon = qualified.indexOf(":");
  return colon === -1 ? qualified : qualified.slice(colon + 1);
}

export function decodeXmlText(raw: string) {
  if (!raw.includes("&")) {
    return raw;
  }

  return raw.replace(/&([^;&]{0,12});/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : malformed("character reference");
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : malformed("character reference");
    }
    const named = NAMED_ENTITIES[entity];
    if (named === undefined) {
      return malformed(`unknown entity ${match}`);
    }
    return named;
  });
}

function isNameChar(char: string) {
  return !/[\s/>=]/.test(char);
}

export function parseXml(source: string, handlers: XmlHandlers) {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const stack: string[] = [];
  let index = 0;

  while (index < text.length) {
    const lt = text.indexOf("<", index);
    if (lt === -1) {
      if (text.slice(index).trim()) {
        if (stack.length === 0) {
          malformed("text outside the root element");
        }
        handlers.text?.(decodeXmlText(text.slice(index)));
      }
      break;
    }

    if (lt > index && stack.length > 0) {
      handlers.text?.(decodeXmlText(text.slice(index, lt)));
    }

    if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      if (end === -1) malformed("processing instruction");
      index = end + 2;
      continue;
    }

    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end === -1) malformed("comment");
      index = end + 3;
      continue;
    }

    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end === -1) malformed("CDATA");
      if (stack.length > 0) {
        handlers.text?.(text.slice(lt + 9, end));
      }
      index = end + 3;
      continue;
    }

    if (text.startsWith("<!", lt)) {
      throw new WorkbookParseError(
        "unsafe_workbook",
        "The workbook was refused for safety (document type declarations are not accepted).",
      );
    }

    if (text.startsWith("</", lt)) {
      const end = text.indexOf(">", lt + 2);
      if (end === -1) malformed("end tag");
      const name = localName(text.slice(lt + 2, end).trim());
      const open = stack.pop();
      if (open !== name) {
        malformed(`unexpected </${name}>`);
      }
      handlers.close?.(name);
      index = end + 1;
      continue;
    }

    let cursor = lt + 1;
    while (cursor < text.length && isNameChar(text[cursor]!)) {
      cursor += 1;
    }
    const name = localName(text.slice(lt + 1, cursor));
    if (!name) {
      malformed("element name");
    }

    const attributes: XmlAttributes = {};
    let selfClosing = false;

    for (;;) {
      while (cursor < text.length && /\s/.test(text[cursor]!)) {
        cursor += 1;
      }
      const char = text[cursor];
      if (char === undefined) {
        malformed("unterminated start tag");
      }
      if (char === ">") {
        cursor += 1;
        break;
      }
      if (char === "/" && text[cursor + 1] === ">") {
        selfClosing = true;
        cursor += 2;
        break;
      }

      const nameStart = cursor;
      while (cursor < text.length && isNameChar(text[cursor]!)) {
        cursor += 1;
      }
      const attributeName = text.slice(nameStart, cursor);
      while (cursor < text.length && /\s/.test(text[cursor]!)) {
        cursor += 1;
      }
      if (!attributeName || text[cursor] !== "=") {
        malformed("attribute");
      }
      cursor += 1;
      while (cursor < text.length && /\s/.test(text[cursor]!)) {
        cursor += 1;
      }
      const quote = text[cursor];
      if (quote !== '"' && quote !== "'") {
        malformed("attribute quote");
      }
      const valueEnd = text.indexOf(quote, cursor + 1);
      if (valueEnd === -1) {
        malformed("attribute value");
      }
      attributes[localName(attributeName)] = decodeXmlText(text.slice(cursor + 1, valueEnd));
      cursor = valueEnd + 1;
    }

    handlers.open?.(name, attributes, selfClosing);
    if (selfClosing) {
      handlers.close?.(name);
    } else {
      stack.push(name);
      if (stack.length > MAX_DEPTH) {
        malformed("nesting too deep");
      }
    }
    index = cursor;
  }

  if (stack.length > 0) {
    malformed(`unclosed <${stack[stack.length - 1]}>`);
  }
}
