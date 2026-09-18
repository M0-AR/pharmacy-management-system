import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, Button, Card, Empty, Field, Input, Select } from './ui';

describe('ui primitives', () => {
  it('Button renders variants with accessible names', () => {
    const { rerender } = render(<Button>Primary</Button>);
    expect(screen.getByRole('button', { name: 'Primary' })).toHaveClass('btn-primary');
    rerender(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-danger');
    rerender(<Button variant="ghost" disabled>Ghost</Button>);
    expect(screen.getByRole('button', { name: 'Ghost' })).toBeDisabled();
  });

  it('Badge renders every tone', () => {
    const { container } = render(
      <>
        <Badge tone="green">ok</Badge>
        <Badge tone="amber">warn</Badge>
        <Badge tone="red">bad</Badge>
        <Badge tone="blue">info</Badge>
        <Badge>plain</Badge>
      </>,
    );
    expect(container.querySelectorAll('.badge')).toHaveLength(5);
    expect(screen.getByText('bad')).toHaveClass('badge-red');
  });

  it('Empty shows title and hint', () => {
    render(<Empty title="Nothing here" hint="Add something" />);
    expect(screen.getByText('Nothing here')).toBeVisible();
    expect(screen.getByText('Add something')).toBeVisible();
  });

  it('Input, Select, Card and Field render labelled controls', () => {
    render(
      <Card>
        <Field label="Pick one" hint="choose wisely">
          <Select aria-label="choice">
            <option value="a">A</option>
          </Select>
        </Field>
        <Field label="Type here">
          <Input placeholder="hello" />
        </Field>
      </Card>,
    );
    expect(screen.getByPlaceholderText('hello')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'choice' })).toBeVisible();
    expect(screen.getByText('choose wisely')).toBeVisible();
  });
});
