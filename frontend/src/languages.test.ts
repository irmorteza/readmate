import { expect, it } from "vitest";
import source from "../../contract/languages.json";
import copy from "./languages.json";

it("frontend copy matches contract/languages.json (run python scripts/sync_languages.py)", () =>
  expect(copy).toEqual(source));
