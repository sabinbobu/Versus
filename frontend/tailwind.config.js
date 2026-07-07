/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      fontFamily: {
        heading: ["Unbounded", "sans-serif"],
        body: ["Outfit", "sans-serif"],
      },
      colors: {
        sidea: "#06B6D4",
        sideb: "#EC4899",
        opt1: "#FF3366",
        opt2: "#00E5FF",
        opt3: "#FFD700",
        opt4: "#00FF66",
      },
      keyframes: {
        "pop-in": {
          "0%": { opacity: 0, transform: "scale(0.8)" },
          "100%": { opacity: 1, transform: "scale(1)" },
        },
      },
      animation: {
        "pop-in": "pop-in 0.4s ease-out",
      },
    },
  },
  plugins: [],
};
