'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type PrimaryNavLinkProps = {
  href: string;
  children: React.ReactNode;
  active?: boolean;
  exact?: boolean;
};

export default function PrimaryNavLink({ href, children, active, exact = false }: PrimaryNavLinkProps) {
  const pathname = usePathname();
  const isActive = active ?? (exact ? pathname === href : pathname === href || pathname?.startsWith(`${href}/`));

  return (
    <Link href={href} className={`portal-nav-link${isActive ? ' active' : ''}`} aria-current={isActive ? 'page' : undefined}>
      {children}
    </Link>
  );
}
