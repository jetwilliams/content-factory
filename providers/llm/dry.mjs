// The dry LLM: makes no calls. Steps that see `canned: true` use their built-in example output
// (examples/how-tides-work/ for that topic, a clearly marked template for any other topic).
export default {
  name: 'dry',
  paid: false,
  canned: true,
  async complete() {
    throw new Error('the dry LLM provider does not generate text; the step should use its canned output');
  },
};
