/* eslint-env node */
require("@rushstack/eslint-patch/modern-module-resolution");

module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ["@typescript-eslint", "react-hooks", "react-refresh"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
    ...require("eslint-plugin-react-hooks").configs.recommended.rules,
    "react-hooks/set-state-in-effect": "off",
    "react-hooks/refs": "off",
  },
};
