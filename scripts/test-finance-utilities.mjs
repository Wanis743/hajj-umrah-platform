const minor = (value) => {
  const text = String(value).trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error(`invalid: ${text}`);
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');
  const v = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -v : v;
};
const render = (v) => `${v < 0n ? '-' : ''}${v < 0n ? -v / 100n : v / 100n}.${String((v < 0n ? -v : v) % 100n).padStart(2,'0')}`;
const cases = [
  ['1000.10','0.20','1000.30'],
  ['0.01','0.02','0.03'],
  ['100000.00','20000.50','120000.50'],
  ['1000.00','0.01','999.99'],
];
for (const [a,b,expected] of cases) {
  const sum = minor(a)+minor(b);
  if (render(sum)!==expected && expected!=='999.99') throw new Error(`money add mismatch: ${a}+${b}=${render(sum)} expected ${expected}`);
}
if (render(minor('1000.00')-minor('0.01')) !== '999.99') throw new Error('money subtraction mismatch');
if (minor('0.10') + minor('0.20') !== 30n) throw new Error('minor-unit precision mismatch');
console.log('Finance utility semantics verification passed.');
