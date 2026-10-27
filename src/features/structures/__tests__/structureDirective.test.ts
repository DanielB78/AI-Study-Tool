import { describe, expect, it } from 'vitest';
import { ContentParseError } from '../../ai/contentFirst/types';
import { createPhysicsConceptTemplate } from '../factory';
import {
  parseStructureSlots,
  resolveStructureInstances,
  splitStructureDocument,
} from '../structureDirective';

const PHYSICS_ONE = `:::structure Physics Concept Template

:::Describe the concept in one sentence.
Simple harmonic motion is oscillation with acceleration proportional to displacement towards equilibrium.
:::

:::Give the governing equation.
$$
F=-kx
$$
:::

:::Explain the physical meaning.
The negative sign shows the restoring force acts opposite to displacement.
:::

:::endstructure`;

const PHYSICS_TWO = `${PHYSICS_ONE}

:::structure Physics Concept Template

:::Describe the concept in one sentence.
Uniform circular motion is motion at constant speed on a circular path.
:::

:::Give the governing equation.
$$
a_c=\\frac{v^2}{r}
$$
:::

:::Explain the physical meaning.
Acceleration is directed towards the centre of the circle.
:::

:::endstructure`;

describe(':::structure directive parsing', () => {
  it('parses a single physics concept instance', () => {
    const doc = splitStructureDocument(PHYSICS_ONE);
    expect(doc.instances).toHaveLength(1);
    expect(doc.instances[0]!.templateName).toBe('Physics Concept Template');
    expect(doc.instances[0]!.slots).toHaveLength(3);
    expect(doc.instances[0]!.slots[1]!.body).toContain('F=-kx');
  });

  it('parses multiple instances in one response', () => {
    const doc = splitStructureDocument(PHYSICS_TWO);
    expect(doc.instances).toHaveLength(2);
    expect(doc.instances[1]!.slots[0]!.body).toMatch(/circular motion/i);
  });

  it('ignores :::structure inside fenced code examples', () => {
    const md = [
      'Here is an example:',
      '```markdown',
      ':::structure Example',
      ':::slot',
      'x',
      ':::',
      ':::endstructure',
      '```',
      '',
      'Real content.',
    ].join('\n');
    const doc = splitStructureDocument(md);
    expect(doc.instances).toHaveLength(0);
    expect(doc.preamble).toContain(':::structure Example');
  });

  it('rejects unclosed structure / slot markers', () => {
    expect(() =>
      splitStructureDocument(':::structure Physics Concept Template\n:::x\n'),
    ).toThrow(ContentParseError);
    expect(() =>
      parseStructureSlots(':::Describe the concept in one sentence.\nHello\n'),
    ).toThrow(/Unclosed slot/);
  });

  it('supports nested :::graph inside a graph slot', () => {
    const body = [
      ':::Show the displacement graph.',
      ':::graph',
      'expression: cos(x)',
      'title: Displacement',
      ':::',
      ':::',
    ].join('\n');
    const slots = parseStructureSlots(body);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.body).toContain(':::graph');
    expect(slots[0]!.body).toContain('expression: cos(x)');
    expect(slots[0]!.body.trim().endsWith(':::')).toBe(true);
  });

  it('resolves slots against the selected template deterministically', () => {
    const template = createPhysicsConceptTemplate();
    // Make graph optional already; required slots are the first three + graph optional
    const doc = splitStructureDocument(PHYSICS_ONE);
    const resolved = resolveStructureInstances(doc, template);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.slotBodies.has('concept_sentence')).toBe(true);
    expect(resolved[0]!.slotBodies.has('governing_equation')).toBe(true);
    expect(resolved[0]!.slotBodies.has('physical_meaning')).toBe(true);
  });

  it('rejects unknown template names and unknown / duplicate slots', () => {
    const template = createPhysicsConceptTemplate();
    expect(() =>
      resolveStructureInstances(
        splitStructureDocument(
          PHYSICS_ONE.replace('Physics Concept Template', 'Other'),
        ),
        template,
      ),
    ).toThrow(/Unknown structure/);

    const dup = `:::structure Physics Concept Template

:::Describe the concept in one sentence.
A
:::

:::Describe the concept in one sentence.
B
:::

:::Give the governing equation.
$$
x
$$
:::

:::Explain the physical meaning.
C
:::

:::endstructure`;
    expect(() =>
      resolveStructureInstances(splitStructureDocument(dup), template),
    ).toThrow(/Duplicate slot/);

    const unknown = `:::structure Physics Concept Template

:::Describe the concept in one sentence.
A
:::

:::Give the governing equation.
$$
x
$$
:::

:::Explain the physical meaning.
C
:::

:::Totally invented slot
nope
:::

:::endstructure`;
    expect(() =>
      resolveStructureInstances(splitStructureDocument(unknown), template),
    ).toThrow(/Unknown structure slot/);
  });

  it('requires a selected template when :::structure is present', () => {
    expect(() =>
      resolveStructureInstances(splitStructureDocument(PHYSICS_ONE), null),
    ).toThrow(/selected structure template/);
  });
});
