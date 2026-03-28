/**
 * Skeleton Loader Component
 * Used for loading states across the application
 * CSS animations defined in public/design-system.css
 */

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'avatar' | 'card' | 'rectangle';
  width?: string | number;
  height?: string | number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'rectangle',
  width,
  height,
}) => {
  const variantClasses = {
    text: 'skeleton skeleton-text w-full',
    avatar: 'skeleton skeleton-avatar',
    card: 'skeleton skeleton-card',
    rectangle: 'skeleton',
  };

  const style: React.CSSProperties = {
    ...(width && { width: typeof width === 'number' ? `${width}px` : width }),
    ...(height && { height: typeof height === 'number' ? `${height}px` : height }),
  };

  return (
    <div
      className={`${variantClasses[variant]} ${className}`}
      style={style}
      role="status"
      aria-label="Loading..."
    />
  );
};

/**
 * SkeletonGroup: Renders multiple skeleton items for list/grid loading
 */
interface SkeletonGroupProps {
  count?: number;
  variant?: 'text' | 'avatar' | 'card';
  className?: string;
  spacing?: string;
}

export const SkeletonGroup: React.FC<SkeletonGroupProps> = ({
  count = 3,
  variant = 'card',
  className = '',
  spacing = 'gap-4',
}) => {
  return (
    <div className={`flex flex-col ${spacing} ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} variant={variant} />
      ))}
    </div>
  );
};
