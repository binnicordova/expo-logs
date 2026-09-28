import { defaultFormatter, formatArgs, inspect, utf8Length } from '../format';
import { LogLevel } from '../types';

describe('formatArgs', () => {
  it('joins arguments like console.log', () => {
    expect(formatArgs(['hello', 42, true, null, undefined])).toBe('hello 42 true null undefined');
  });

  it('supports printf-style tokens', () => {
    expect(formatArgs(['%s is %d years (%i) %f %j %%', 'Ana', 30.5, 30.9, '1.5', { a: 1 }])).toBe(
      'Ana is 30.5 years (30) 1.5 {"a":1} %'
    );
    expect(formatArgs(['%c styled', 'color: red'])).toBe(' styled');
  });

  it('serializes objects, arrays, maps, sets and circular references', () => {
    const obj: any = { a: 1, b: [1, 'two'], 'x-y': new Map([['k', 1]]), s: new Set([1]) };
    obj.self = obj;
    expect(inspect(obj)).toBe(
      '{ a: 1, b: [ 1, "two" ], "x-y": Map(1) { "k" => 1 }, s: Set(1) { 1 }, self: [Circular] }'
    );
  });

  it('prints errors with their stack', () => {
    const error = new Error('boom');
    expect(formatArgs(['failed:', error])).toContain('Error: boom');
  });
});

describe('defaultFormatter', () => {
  it('matches react-native-file-logger output', () => {
    expect(defaultFormatter(LogLevel.Warning, 'msg')).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[WARN\] {2}msg$/
    );
  });
});

describe('utf8Length', () => {
  it('counts multi-byte characters', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('ñ')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
  });
});
