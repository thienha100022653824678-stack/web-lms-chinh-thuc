/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./lms.html",
    "./lesson.html"
  ],
  theme: {
    extend: {
      colors: {
        brandCream: "#FCF8F2",
        brandGreen: "#2A4B2A",
        brandGreenLight: "#3E6B3E",
        brandBrown: "#2D1914",
        brandOrange: "#D96B27",
        brandGray: "#F5EFEB"
      },
      fontFamily: {
        sans: ['"Be Vietnam Pro"', "sans-serif"],
        serif: ['"Playfair Display"', "serif"]
      }
    }
  },
  plugins: []
};
