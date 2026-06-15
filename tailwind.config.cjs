/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.tsx"],
  safelist: ["text-green-600", "text-blue-600", "text-pink-600", "text-black"],
  plugins: [require("@tailwindcss/forms")],
};
