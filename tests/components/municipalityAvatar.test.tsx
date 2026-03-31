import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MunicipalityAvatar from '../../components/MunicipalityAvatar';

describe('MunicipalityAvatar', () => {
  it('renders an img element', () => {
    render(<MunicipalityAvatar name="Haninge kommun" />);
    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
  });

  it('sets alt text with municipality name', () => {
    render(<MunicipalityAvatar name="Stockholm kommun" />);
    const img = screen.getByAltText('Stockholm kommun vapen');
    expect(img).toBeInTheDocument();
  });

  it('constructs src URL from first word of name', () => {
    render(<MunicipalityAvatar name="Stockholm stad" />);
    const img = screen.getByRole('img');
    expect((img as HTMLImageElement).src).toContain('Stockholm_vapen.svg');
  });

  it('applies default md size classes', () => {
    const { container } = render(<MunicipalityAvatar name="Malmö" />);
    const sizeDiv = container.querySelector('.w-10');
    expect(sizeDiv).toBeInTheDocument();
  });

  it('applies sm size classes when size="sm"', () => {
    const { container } = render(<MunicipalityAvatar name="Malmö" size="sm" />);
    const sizeDiv = container.querySelector('.w-6');
    expect(sizeDiv).toBeInTheDocument();
  });

  it('applies lg size classes when size="lg"', () => {
    const { container } = render(<MunicipalityAvatar name="Malmö" size="lg" />);
    const sizeDiv = container.querySelector('.w-16');
    expect(sizeDiv).toBeInTheDocument();
  });

  it('passes additional className to wrapper', () => {
    const { container } = render(<MunicipalityAvatar name="Lund" className="my-custom-class" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('my-custom-class');
  });
});
