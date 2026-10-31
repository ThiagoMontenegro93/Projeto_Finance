import { isValidCpf, parseWhatsapp } from './whatsapp-importer';

describe('WhatsApp Importer', () => {
  it('formato linha NOME;CPF;...', () => {
    const r = parseWhatsapp('Maria Souza;52998224725;1234567;10/05/1985;Casada;Costureira;11988887777;;maria@x.com;01001000;Praça da Sé;100;;Sé;São Paulo;sp;maria@x.com;Nubank');
    expect(r.format).toBe('LINHA');
    expect(r.fields.cpf).toBe('529.982.247-25');
    expect(r.fields.cep).toBe('01001-000');
    expect(r.fields.birthDate).toBe('1985-05-10');
    expect(r.fields.state).toBe('SP');
    expect(r.preview).toBe('17 de 18 campos');
  });

  it('formato bloco Nome: ... CPF: ...', () => {
    const txt = `*Nome:* João da Silva
CPF: 529.982.247-25
Telefone: (11) 97777-6666
CEP: 01001-000
Endereço: Praça da Sé
Número: 10
Bairro: Sé
Cidade: São Paulo
UF: SP
Pix: 11977776666
Banco: Inter
Profissão: Pedreiro
Estado civil: Solteiro
Nascimento: 01/02/1990`;
    const r = parseWhatsapp(txt);
    expect(r.format).toBe('BLOCO');
    expect(r.fields.name).toBe('João da Silva');
    expect(r.fields.phone).toBe('11977776666');
    expect(r.preview).toBe('15 de 18 campos');
    expect(r.missing).toEqual(['RG', 'E-mail', 'Complemento']);
  });

  it('valida CPF', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('111.111.111-11')).toBe(false);
  });
});
