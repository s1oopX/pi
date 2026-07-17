import brandIconUrl from "../../../../assets/brand-icon.svg";

interface BrandIconProps {
  className?: string;
}

export function BrandIcon({ className }: BrandIconProps) {
  return <img className={className} src={brandIconUrl} alt="" aria-hidden="true" draggable={false} />;
}
