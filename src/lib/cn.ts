import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges class names, letting a later Tailwind utility win over an earlier one. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
