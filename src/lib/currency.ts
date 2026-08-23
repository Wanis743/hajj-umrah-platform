export const money = (value: number, currency: string = 'DZD') => {
  return new Intl.NumberFormat('fr-DZ', { style: 'currency', currency }).format(value);
};
