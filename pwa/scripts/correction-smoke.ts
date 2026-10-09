import assert from 'node:assert/strict';
import { buildMeasuredLoudnormFilter, dbToLinear, parseLastLoudnormMeasurement } from '../src/loudness';

const log = `
[Parsed_loudnorm_0 @ 0x1] {
  "input_i" : "-23.40",
  "input_tp" : "-3.10",
  "input_lra" : "7.20",
  "input_thresh" : "-33.50",
  "output_i" : "-16.10",
  "output_tp" : "-1.50",
  "output_lra" : "6.80",
  "output_thresh" : "-26.20",
  "normalization_type" : "linear",
  "target_offset" : "0.10"
}
`;

const measured = parseLastLoudnormMeasurement(log);
assert.equal(measured.inputI, -23.4);
assert.equal(measured.inputTP, -3.1);
assert.equal(measured.normalizationType, 'linear');
assert.equal(measured.targetOffset, 0.1);

const filter = buildMeasuredLoudnormFilter(measured);
assert.match(filter, /measured_I=-23\.4/);
assert.match(filter, /measured_TP=-3\.1/);
assert.match(filter, /linear=true/);
assert.ok(Math.abs(dbToLinear(-1.5) - 0.841395) < 0.00001);

assert.throws(() => parseLastLoudnormMeasurement('no json here'), /測定JSON/);

console.log('Audio correction parser/filter smoke test: PASS');
