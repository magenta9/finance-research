module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ["@typescript-eslint", "react-hooks", "react-refresh", "quantdesk"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
  ignorePatterns: ["dist", "build", "release", "coverage", "packages/eslint-plugin-quantdesk/fixtures", "packages/eslint-plugin-quantdesk/index.cjs"],
  overrides: [
    {
      files: [
        "packages/main/src/**/*.{ts,tsx}",
        "packages/preload/src/**/*.{ts,tsx}",
        "packages/renderer/src/**/*.{ts,tsx}",
      ],
      excludedFiles: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
      rules: {
        "quantdesk/no-silent-catch": "error",
      },
    },
    {
      files: [
        "packages/main/src/**/*.{ts,tsx}",
        "packages/preload/src/**/*.{ts,tsx}",
        "packages/renderer/src/**/*.{ts,tsx}",
        "packages/renderer/vite.config.ts",
        "vitest.config.ts",
      ],
      excludedFiles: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
      rules: {
        "quantdesk/no-runtime-dynamic-import": "error",
      },
    },
    {
      files: ["packages/main/src/**/*.{ts,tsx}"],
      excludedFiles: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
      rules: {
        "quantdesk/no-direct-sql-outside-repos": "error",
      },
    },
    {
      files: ["packages/renderer/**/*.{ts,tsx}"],
      rules: {
        "react-refresh/only-export-components": [
          "warn",
          {
            allowConstantExport: true,
          },
        ],
      },
    },
    {
      files: [
        "packages/renderer/src/routes/**/*.{ts,tsx}",
        "packages/renderer/src/components/**/*.{ts,tsx}",
      ],
      rules: {
        "quantdesk/no-raw-interactive-elements": "error",
      },
    },
    {
      files: [
        "packages/renderer/src/routes/**/*.{ts,tsx}",
        "packages/renderer/src/stores/**/*.{ts,tsx}",
        "packages/renderer/src/components/**/*.{ts,tsx}",
      ],
      rules: {
        "quantdesk/no-renderer-dev-imports": "error",
      },
    },
  ],
};
