/**
 * Tests for Skeleton loading component
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton, SkeletonGroup } from '../../components/ui/Skeleton';
import React from 'react';

describe('Skeleton', () => {
  describe('Rendering', () => {
    it('renders skeleton div with skeleton class', () => {
      const { container } = render(<Skeleton />);
      const skeleton = container.querySelector('.skeleton');
      expect(skeleton).toBeInTheDocument();
    });

    it('renders with text variant', () => {
      const { container } = render(<Skeleton variant="text" />);
      const skeleton = container.querySelector('.skeleton-text');
      expect(skeleton).toBeInTheDocument();
    });

    it('renders with avatar variant', () => {
      const { container } = render(<Skeleton variant="avatar" />);
      const skeleton = container.querySelector('.skeleton-avatar');
      expect(skeleton).toBeInTheDocument();
    });

    it('renders with card variant', () => {
      const { container } = render(<Skeleton variant="card" />);
      const skeleton = container.querySelector('.skeleton-card');
      expect(skeleton).toBeInTheDocument();
    });

    it('renders with rectangle variant (default)', () => {
      const { container } = render(<Skeleton variant="rectangle" />);
      const skeleton = container.querySelector('.skeleton');
      expect(skeleton).toBeInTheDocument();
    });
  });

  describe('Custom Styling', () => {
    it('applies custom className', () => {
      const { container } = render(<Skeleton className="custom-class" />);
      const skeleton = container.querySelector('.custom-class');
      expect(skeleton).toBeInTheDocument();
    });

    it('applies custom width', () => {
      const { container } = render(<Skeleton width={200} />);
      const skeleton = container.querySelector('.skeleton');
      expect(skeleton).toHaveStyle({ width: '200px' });
    });

    it('applies custom height', () => {
      const { container } = render(<Skeleton height={50} />);
      const skeleton = container.querySelector('.skeleton');
      expect(skeleton).toHaveStyle({ height: '50px' });
    });

    it('applies custom width as string', () => {
      const { container } = render(<Skeleton width="100%" />);
      const skeleton = container.querySelector('.skeleton');
      expect(skeleton).toHaveStyle({ width: '100%' });
    });

    it('applies both width and height', () => {
      const { container } = render(<Skeleton width={100} height={100} />);
      const skeleton = container.querySelector('.skeleton');
      expect(skeleton).toHaveStyle({
        width: '100px',
        height: '100px',
      });
    });
  });

  describe('Accessibility', () => {
    it('has loading role and label', () => {
      render(<Skeleton />);
      const skeleton = screen.getByRole('status');
      expect(skeleton).toHaveAttribute('aria-label', 'Loading...');
    });

    it('text variant is marked as loading', () => {
      render(<Skeleton variant="text" />);
      const skeleton = screen.getByRole('status');
      expect(skeleton).toBeInTheDocument();
    });
  });
});

describe('SkeletonGroup', () => {
  describe('Rendering', () => {
    it('renders default count of 3 skeletons', () => {
      const { container } = render(<SkeletonGroup />);
      const skeletons = container.querySelectorAll('.skeleton');
      expect(skeletons.length).toBe(3);
    });

    it('renders custom count of skeletons', () => {
      const { container } = render(<SkeletonGroup count={5} />);
      const skeletons = container.querySelectorAll('.skeleton');
      expect(skeletons.length).toBe(5);
    });

    it('renders skeletons with specified variant', () => {
      const { container } = render(<SkeletonGroup count={2} variant="card" />);
      const skeletons = container.querySelectorAll('.skeleton-card');
      expect(skeletons.length).toBe(2);
    });
  });

  describe('Layout & Spacing', () => {
    it('applies default gap spacing', () => {
      const { container } = render(<SkeletonGroup />);
      const wrapper = container.querySelector('.flex');
      expect(wrapper).toHaveClass('gap-4');
    });

    it('applies custom spacing', () => {
      const { container } = render(<SkeletonGroup spacing="gap-8" />);
      const wrapper = container.querySelector('.gap-8');
      expect(wrapper).toBeInTheDocument();
    });

    it('applies custom className to wrapper', () => {
      const { container } = render(<SkeletonGroup className="custom-wrapper" />);
      const wrapper = container.querySelector('.custom-wrapper');
      expect(wrapper).toBeInTheDocument();
    });

    it('uses flex column layout', () => {
      const { container } = render(<SkeletonGroup />);
      const wrapper = container.querySelector('.flex-col');
      expect(wrapper).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('all skeleton items have loading role', () => {
      render(<SkeletonGroup count={3} />);
      const skeletons = screen.getAllByRole('status');
      expect(skeletons.length).toBe(3);
    });
  });
});
