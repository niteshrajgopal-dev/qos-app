import { describe, expect, it } from "vitest";

import { WorkbookParseError } from "@/lib/workbook/errors";
import { parseXml } from "@/lib/workbook/xml";

function collect(source: string) {
  const events: string[] = [];
  parseXml(source, {
    open: (name, attributes, selfClosing) => events.push(`<${name}${JSON.stringify(attributes)}${selfClosing ? "/" : ""}>`),
    close: (name) => events.push(`</${name}>`),
    text: (text) => events.push(text),
  });
  return events;
}

function errorCode(source: string) {
  try {
    collect(source);
  } catch (error) {
    if (error instanceof WorkbookParseError) return error.code;
    throw error;
  }
  return "no error";
}

describe("strict workbook XML tokenizer", () => {
  it("reports local names for prefixed and default namespaces and decodes text", () => {
    expect(collect('﻿<?xml version="1.0"?><x:c r="A1" t=\'s\'><x:v>a &amp; b &#x41;&#66; &lt;</x:v></x:c>')).toEqual([
      '<c{"r":"A1","t":"s"}>',
      '<v{}>',
      "a & b AB <",
      "</v>",
      "</c>",
    ]);
    expect(collect('<row r="1"><c r="A1"/><![CDATA[<raw>]]><!-- note --></row>')).toEqual([
      '<row{"r":"1"}>',
      '<c{"r":"A1"}/>',
      "</c>",
      "<raw>",
      "</row>",
    ]);
  });

  it("keeps '>' inside attribute values", () => {
    expect(collect('<cfRule text="a>b"/>')).toEqual(['<cfRule{"text":"a>b"}/>', "</cfRule>"]);
  });

  it("refuses document type declarations, so external entities and entity expansion cannot happen", () => {
    expect(
      errorCode('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><x>&xxe;</x>'),
    ).toBe("unsafe_workbook");
    expect(errorCode('<!DOCTYPE lol [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><x>&b;</x>')).toBe("unsafe_workbook");
  });

  it("rejects undeclared entities and broken markup as malformed", () => {
    expect(errorCode("<x>&xxe;</x>")).toBe("malformed_workbook");
    expect(errorCode("<x><y></x>")).toBe("malformed_workbook");
    expect(errorCode("<x>")).toBe("malformed_workbook");
    expect(errorCode('<x a="1></x>')).toBe("malformed_workbook");
  });
});
