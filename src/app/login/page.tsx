import type { Metadata } from 'next';
import { FormLogin } from './FormLogin';

export const metadata: Metadata = { title: 'Masuk' };

export default function HalamanLogin() {
  return <FormLogin />;
}
