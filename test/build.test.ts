import { expect, test } from "bun:test";
import { shadowSafe } from "../scripts/build-lib";

test("shadowSafe unwraps Tailwind's @property fallback so it applies inside shadow roots", () => {
  const css =
    "@layer properties{@supports ((-webkit-hyphens:none)) and (not (margin-trim:inline)){*,:before{--tw-shadow:0 0 #0000}}}.a{color:red}";
  expect(shadowSafe(css)).toBe("@layer properties{*,:before{--tw-shadow:0 0 #0000}}.a{color:red}");
});

test("shadowSafe leaves CSS without the fallback untouched", () => {
  expect(shadowSafe(".a{color:red}")).toBe(".a{color:red}");
});
