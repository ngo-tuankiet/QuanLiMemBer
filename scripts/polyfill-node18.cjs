// Polyfill cho Node.js 18 khi tsx dung Array.prototype.toReversed
if (!Array.prototype.toReversed) {
  Array.prototype.toReversed = function () {
    return [...this].reverse();
  };
}
